using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using DataLens.Api.Analytics;
using DataLens.Api.Exports;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using UglyToad.PdfPig;

namespace DataLens.Tests.Analytics;

public sealed class PdfExportApiTests(TestDatabaseFixture fixture) : IClassFixture<TestDatabaseFixture>
{
    [Fact]
    public async Task Marks_queued_exports_failed_after_an_API_restart()
    {
        await using var initialize = fixture.CreateContext();
        Guid exportId;
        TestUser user;
        using (var originalFactory = new DataLensApiFactory(fixture.ConnectionString))
        using (var originalClient = originalFactory.CreateClient())
        {
            user = await RegisterAsync(originalClient);
            await using var db = fixture.CreateContext();
            var job = new ExportJob
            {
                OwnerId = user.Id,
                TargetName = "Interrupted report",
                FileName = "Interrupted report.pdf",
                Type = ExportJobType.DashboardPdf,
                Status = ExportJobStatus.Queued
            };
            db.ExportJobs.Add(job);
            await db.SaveChangesAsync();
            exportId = job.Id;
        }

        using var restartedFactory = new DataLensApiFactory(fixture.ConnectionString);
        using var restartedClient = restartedFactory.CreateClient();
        var login = await restartedClient.PostAsJsonAsync("/api/auth/login", new
        {
            email = user.Email,
            password = "StrongPassword1!"
        });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var auth = await login.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        restartedClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth.AccessToken);

        ExportJobResponse? recovered = null;
        for (var attempt = 0; attempt < 100; attempt++)
        {
            recovered = await restartedClient.GetFromJsonAsync<ExportJobResponse>($"/api/exports/{exportId}");
            if (recovered?.Status == "Failed") break;
            await Task.Delay(50);
        }

        Assert.NotNull(recovered);
        Assert.Equal("Failed", recovered.Status);
        Assert.Contains("restarted", recovered.ErrorMessage, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Exports_chart_and_dashboard_as_valid_PDFs_containing_SQL_query_results()
    {
        await using var initialize = fixture.CreateContext();
        using var factory = new DataLensApiFactory(fixture.ConnectionString);
        using var owner = factory.CreateClient();
        var ownerUser = await RegisterAsync(owner);

        using var multipart = new MultipartFormDataContent();
        var csv = new ByteArrayContent(Encoding.UTF8.GetBytes("category,amount\nAlpha,10.5\nBeta,20\n"));
        csv.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        multipart.Add(csv, "file", "pdf-test.csv");
        multipart.Add(new StringContent("PDF test data"), "name");
        var uploadResponse = await owner.PostAsync("/api/datasets", multipart);
        Assert.Equal(HttpStatusCode.Accepted, uploadResponse.StatusCode);
        var upload = await uploadResponse.Content.ReadFromJsonAsync<UploadResponse>();
        Assert.NotNull(upload);
        await WaitForImportAsync(owner, upload.JobId);

        var chartResponse = await owner.PostAsJsonAsync("/api/charts", new SavedChartRequest(
            "PDF revenue chart",
            "Real SQL-backed chart",
            upload.DatasetId,
            "bar",
            new DatasetAnalyticsRequest(
                0,
                [new AnalyticsMetric("sum", 1)],
                [],
                20,
                [0],
                "m0",
                "desc"),
            new ChartVisualOptions(Title: "PDF revenue chart")));
        Assert.Equal(HttpStatusCode.Created, chartResponse.StatusCode);
        var chart = await chartResponse.Content.ReadFromJsonAsync<SavedChartResponse>();
        Assert.NotNull(chart);

        var dashboardResponse = await owner.PostAsJsonAsync("/api/dashboards", new DashboardRequest("PDF sales dashboard"));
        Assert.Equal(HttpStatusCode.Created, dashboardResponse.StatusCode);
        var dashboard = await dashboardResponse.Content.ReadFromJsonAsync<DashboardResponse>();
        Assert.NotNull(dashboard);
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync(
            $"/api/dashboards/{dashboard.Id}/widgets",
            new DashboardWidgetRequest(chart.Id, 0, 0, 6, 4))).StatusCode);

        var chartJob = await CreateAndWaitForPdfAsync(owner, $"/api/exports/charts/{chart.Id}", "PDF revenue chart");
        await AssertContainsPdfDataAsync(owner, chartJob, "PDF revenue chart");
        var dashboardJob = await CreateAndWaitForPdfAsync(owner, $"/api/exports/dashboards/{dashboard.Id}", "PDF sales dashboard");
        await AssertContainsPdfDataAsync(owner, dashboardJob, "PDF sales dashboard");

        await owner.DeleteAsync($"/api/exports/{chartJob.Id}");
        await owner.DeleteAsync($"/api/exports/{dashboardJob.Id}");
        await using var db = fixture.CreateContext();
        var dataset = await db.Datasets.SingleAsync(item => item.Id == upload.DatasetId);
        var importer = new DataLens.Infrastructure.Imports.DatasetCsvImporter(
            db,
            new Microsoft.Extensions.Configuration.ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
            }).Build());
        await importer.DropTableAsync(dataset.Id, CancellationToken.None);
    }

    private static async Task<ExportJobResponse> CreateAndWaitForPdfAsync(HttpClient client, string path, string targetName)
    {
        var response = await client.PostAsJsonAsync(path, new PdfExportRequest());
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var job = await response.Content.ReadFromJsonAsync<ExportJobResponse>();
        Assert.NotNull(job);
        Assert.Equal(targetName, job.TargetName);
        Assert.EndsWith(".pdf", job.FileName, StringComparison.OrdinalIgnoreCase);

        for (var attempt = 0; attempt < 200; attempt++)
        {
            var current = await client.GetFromJsonAsync<ExportJobResponse>($"/api/exports/{job.Id}");
            if (current?.Status == "Completed") return current;
            if (current?.Status == "Failed") throw new InvalidOperationException(current.ErrorMessage);
            await Task.Delay(100);
        }

        throw new TimeoutException($"The PDF export '{targetName}' did not complete.");
    }

    private static async Task AssertContainsPdfDataAsync(HttpClient client, ExportJobResponse job, string title)
    {
        var response = await client.GetAsync($"/api/exports/{job.Id}/download");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF-", Encoding.ASCII.GetString(bytes, 0, Math.Min(bytes.Length, 5)));
        using var stream = new MemoryStream(bytes);
        using var document = PdfDocument.Open(stream);
        Assert.NotEmpty(document.GetPages());
        var text = string.Join(' ', document.GetPages().Select(page => page.Text));
        Assert.Contains(title, text, StringComparison.Ordinal);
        Assert.Contains("Alpha", text, StringComparison.Ordinal);
        Assert.Contains("10.5", text, StringComparison.Ordinal);
        Assert.Contains("Beta", text, StringComparison.Ordinal);
        Assert.Contains("20", text, StringComparison.Ordinal);
    }

    private static async Task WaitForImportAsync(HttpClient client, Guid jobId)
    {
        for (var attempt = 0; attempt < 200; attempt++)
        {
            var job = await client.GetFromJsonAsync<ImportJobStatus>($"/api/import-jobs/{jobId}");
            if (job?.Status == "Completed") return;
            if (job?.Status == "Failed") throw new InvalidOperationException(job.ErrorMessage);
            await Task.Delay(100);
        }
        throw new TimeoutException("The PDF fixture CSV import did not complete.");
    }

    private static async Task<TestUser> RegisterAsync(HttpClient client)
    {
        var email = $"pdf-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "StrongPassword1!",
            firstName = "Pdf",
            lastName = "Tester"
        });
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return auth.User;
    }

    private sealed record AuthResponse(string AccessToken, TestUser User);
    private sealed record TestUser(string Id, string Email);
    private sealed record UploadResponse(Guid JobId, Guid DatasetId);
    private sealed record ImportJobStatus(string Status, string? ErrorMessage);
}
