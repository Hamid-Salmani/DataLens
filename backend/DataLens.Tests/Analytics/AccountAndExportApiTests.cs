using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using DataLens.Api.Analytics;
using DataLens.Api.Exports;
using DataLens.Infrastructure.Data;
using DataLens.Infrastructure.Imports;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Tests.Analytics;

public sealed class AccountAndExportApiTests(TestDatabaseFixture fixture) : IClassFixture<TestDatabaseFixture>
{
    [Fact]
    public async Task Exports_real_dataset_csv_and_account_settings_are_owner_scoped()
    {
        await using var initialize = fixture.CreateContext();
        using var factory = new DataLensApiFactory(fixture.ConnectionString);
        using var owner = factory.CreateClient();
        using var other = factory.CreateClient();
        var ownerUser = await RegisterAsync(owner, "export-owner");
        await RegisterAsync(other, "export-other");

        var profile = await owner.PutAsJsonAsync("/api/auth/profile", new { firstName = "Updated", lastName = "Profile" });
        Assert.Equal(HttpStatusCode.OK, profile.StatusCode);
        var updatedUser = await profile.Content.ReadFromJsonAsync<UserResponse>();
        Assert.NotNull(updatedUser);
        Assert.Equal("Updated", updatedUser.FirstName);

        var passwordChange = await owner.PostAsJsonAsync("/api/auth/change-password", new
        {
            currentPassword = "StrongPassword1!",
            newPassword = "NewStrongPassword2!"
        });
        Assert.Equal(HttpStatusCode.NoContent, passwordChange.StatusCode);
        var oldPassword = await owner.PostAsJsonAsync("/api/auth/login", new { email = ownerUser.Email, password = "StrongPassword1!" });
        Assert.Equal(HttpStatusCode.Unauthorized, oldPassword.StatusCode);
        var newPassword = await owner.PostAsJsonAsync("/api/auth/login", new { email = ownerUser.Email, password = "NewStrongPassword2!" });
        Assert.Equal(HttpStatusCode.OK, newPassword.StatusCode);

        var dashboardResponse = await owner.PostAsJsonAsync("/api/dashboards", new DashboardRequest("Account test"));
        Assert.Equal(HttpStatusCode.Created, dashboardResponse.StatusCode);
        var dashboard = await dashboardResponse.Content.ReadFromJsonAsync<DashboardResponse>();
        Assert.NotNull(dashboard);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsJsonAsync($"/api/dashboards/{dashboard.Id}/default", new { })).StatusCode);

        using var multipart = new MultipartFormDataContent();
        var csv = new ByteArrayContent(Encoding.UTF8.GetBytes("category,amount\nAlpha,10.5\nBeta,20\n"));
        csv.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        multipart.Add(csv, "file", "export-test.csv");
        multipart.Add(new StringContent("Export test"), "name");
        var uploadResponse = await owner.PostAsync("/api/datasets", multipart);
        Assert.Equal(HttpStatusCode.Accepted, uploadResponse.StatusCode);
        var upload = await uploadResponse.Content.ReadFromJsonAsync<UploadResponse>();
        Assert.NotNull(upload);
        await WaitForImportAsync(owner, upload.JobId);

        var createExport = await owner.PostAsJsonAsync("/api/exports", new { datasetId = upload.DatasetId });
        Assert.Equal(HttpStatusCode.Accepted, createExport.StatusCode);
        var export = await createExport.Content.ReadFromJsonAsync<ExportJobResponse>();
        Assert.NotNull(export);
        await WaitForExportAsync(owner, export.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/exports/{export.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/exports/{export.Id}/download")).StatusCode);

        var download = await owner.GetAsync($"/api/exports/{export.Id}/download");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        var exportedCsv = await download.Content.ReadAsStringAsync();
        Assert.Contains("\"category\",\"amount\"", exportedCsv, StringComparison.Ordinal);
        Assert.Contains("\"Alpha\",\"10.5\"", exportedCsv, StringComparison.Ordinal);
        Assert.Contains("\"Beta\",\"20\"", exportedCsv, StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/exports/{export.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/exports/{export.Id}")).StatusCode);
        var rejectedDelete = await SendDeleteJsonAsync(owner, "/api/auth/account", new { password = "incorrect" });
        Assert.Equal(HttpStatusCode.BadRequest, rejectedDelete.StatusCode);
        var deleteAccount = await SendDeleteJsonAsync(owner, "/api/auth/account", new { password = "NewStrongPassword2!" });
        Assert.Equal(HttpStatusCode.NoContent, deleteAccount.StatusCode);

        var remainingDataset = await owner.GetAsync($"/api/datasets/{upload.DatasetId}");
        Assert.Equal(HttpStatusCode.NotFound, remainingDataset.StatusCode);
        await using var verify = fixture.CreateContext();
        Assert.False(await verify.Users.AnyAsync(user => user.Id == ownerUser.Id));
        Assert.False(await verify.Datasets.AnyAsync(dataset => dataset.Id == upload.DatasetId));
        await using var connection = new Microsoft.Data.SqlClient.SqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var exists = connection.CreateCommand();
        exists.CommandText = "SELECT OBJECT_ID(@tableName, N'U')";
        exists.Parameters.AddWithValue("@tableName", $"data.ds_{upload.DatasetId:N}");
        var tableId = await exists.ExecuteScalarAsync();
        Assert.True(tableId is null or DBNull);
    }

    private static async Task WaitForImportAsync(HttpClient client, Guid jobId)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            var job = await client.GetFromJsonAsync<ImportJobStatus>($"/api/import-jobs/{jobId}");
            if (job?.Status == "Completed") return;
            if (job?.Status == "Failed") throw new InvalidOperationException(job.ErrorMessage);
            await Task.Delay(100);
        }
        throw new TimeoutException("The real CSV import did not complete.");
    }

    private static async Task WaitForExportAsync(HttpClient client, Guid jobId)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            var job = await client.GetFromJsonAsync<ExportJobResponse>($"/api/exports/{jobId}");
            if (job?.Status == "Completed") return;
            if (job?.Status == "Failed") throw new InvalidOperationException(job.ErrorMessage);
            await Task.Delay(100);
        }
        throw new TimeoutException("The real CSV export did not complete.");
    }

    private static Task<HttpResponseMessage> SendDeleteJsonAsync(HttpClient client, string path, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Delete, path) { Content = JsonContent.Create(body) };
        return client.SendAsync(request);
    }

    private static async Task<TestUser> RegisterAsync(HttpClient client, string label)
    {
        var email = $"{label}-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "StrongPassword1!",
            firstName = label,
            lastName = "Tester"
        });
        response.EnsureSuccessStatusCode();
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return auth.User;
    }

    private sealed record AuthResponse(string AccessToken, TestUser User);
    private sealed record TestUser(string Id, string Email, string FirstName, string LastName);
    private sealed record UserResponse(string Id, string Email, string FirstName, string LastName);
    private sealed record UploadResponse(Guid JobId, Guid DatasetId);
    private sealed record ImportJobStatus(string Status, string? ErrorMessage);
}
