using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using DataLens.Api.Analytics;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DataLens.Tests.Analytics;

public sealed class SavedChartDashboardApiTests(TestDatabaseFixture fixture) : IClassFixture<TestDatabaseFixture>
{
    [Fact]
    public async Task Enforces_chart_dashboard_ownership_and_layout_concurrency()
    {
        await using var initialize = fixture.CreateContext();
        using var factory = new DataLensApiFactory(fixture.ConnectionString);
        using var ownerClient = factory.CreateClient();
        using var otherClient = factory.CreateClient();
        var owner = await RegisterAsync(ownerClient, "owner");
        var other = await RegisterAsync(otherClient, "other");

        await using (var db = fixture.CreateContext())
        {
            db.Datasets.AddRange(CreateDataset(owner.User.Id, "Owner data"), CreateDataset(other.User.Id, "Other data"));
            await db.SaveChangesAsync();
        }

        var datasetId = await initialize.Datasets.AsNoTracking()
            .Where(item => item.CreatedById == owner.User.Id).Select(item => item.Id).SingleAsync();
        var otherDatasetId = await initialize.Datasets.AsNoTracking()
            .Where(item => item.CreatedById == other.User.Id).Select(item => item.Id).SingleAsync();
        Assert.Contains(datasetId.ToString(), await ownerClient.GetStringAsync("/api/datasets"), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(datasetId.ToString(), await otherClient.GetStringAsync("/api/datasets"), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.GetAsync($"/api/datasets/{datasetId}")).StatusCode);

        var chartRequest = CreateChart(datasetId, "Owner chart");
        var chartResponse = await ownerClient.PostAsJsonAsync("/api/charts", chartRequest);
        Assert.Equal(HttpStatusCode.Created, chartResponse.StatusCode);
        var chart = await chartResponse.Content.ReadFromJsonAsync<SavedChartResponse>();
        Assert.NotNull(chart);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.GetAsync($"/api/charts/{chart.Id}")).StatusCode);

        var otherChartResponse = await otherClient.PostAsJsonAsync("/api/charts", CreateChart(otherDatasetId, "Other chart"));
        Assert.Equal(HttpStatusCode.Created, otherChartResponse.StatusCode);
        var otherChart = await otherChartResponse.Content.ReadFromJsonAsync<SavedChartResponse>();
        Assert.NotNull(otherChart);
        Assert.DoesNotContain(chart.Id.ToString(), await otherClient.GetStringAsync("/api/charts"), StringComparison.OrdinalIgnoreCase);

        var dashboardResponse = await ownerClient.PostAsJsonAsync("/api/dashboards", new DashboardRequest("Operations"));
        Assert.Equal(HttpStatusCode.Created, dashboardResponse.StatusCode);
        var dashboard = await dashboardResponse.Content.ReadFromJsonAsync<DashboardResponse>();
        Assert.NotNull(dashboard);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.GetAsync($"/api/dashboards/{dashboard.Id}")).StatusCode);
        Assert.DoesNotContain(dashboard.Id.ToString(), await otherClient.GetStringAsync("/api/dashboards"), StringComparison.OrdinalIgnoreCase);

        var crossOwnerLayout = new DashboardLayoutRequest(
            dashboard.Version,
            [new DashboardWidgetRequest(otherChart.Id, 0, 0, 6, 4)]);
        var rejectedWidget = await ownerClient.PutAsJsonAsync($"/api/dashboards/{dashboard.Id}/layout", crossOwnerLayout);
        Assert.Equal(HttpStatusCode.BadRequest, rejectedWidget.StatusCode);

        var added = await ownerClient.PostAsJsonAsync(
            $"/api/dashboards/{dashboard.Id}/widgets",
            new DashboardWidgetRequest(chart.Id, 0, 0, 6, 4));
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var loaded = await ownerClient.GetFromJsonAsync<DashboardResponse>($"/api/dashboards/{dashboard.Id}");
        Assert.NotNull(loaded);
        Assert.Single(loaded.Widgets);

        var layout = new DashboardLayoutRequest(
            loaded.Version,
            [new DashboardWidgetRequest(chart.Id, 2, 1, 8, 5, "Revenue")]);
        var savedLayout = await ownerClient.PutAsJsonAsync($"/api/dashboards/{dashboard.Id}/layout", layout);
        Assert.Equal(HttpStatusCode.OK, savedLayout.StatusCode);
        var staleLayout = await ownerClient.PutAsJsonAsync($"/api/dashboards/{dashboard.Id}/layout", layout);
        Assert.Equal(HttpStatusCode.Conflict, staleLayout.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await ownerClient.DeleteAsync($"/api/charts/{chart.Id}")).StatusCode);
        var afterDelete = await ownerClient.GetFromJsonAsync<DashboardResponse>($"/api/dashboards/{dashboard.Id}");
        Assert.NotNull(afterDelete);
        Assert.Empty(afterDelete.Widgets);
    }

    [Fact]
    public async Task Migration_copies_legacy_saved_reports_to_saved_charts()
    {
        using var migrationFixture = new TestDatabaseFixture();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer(migrationFixture.ConnectionString)
            .Options;
        await using var db = new AppDbContext(options);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync("20261112191557_ImportJobRuntime");

        var user = new AppUser
        {
            UserName = "legacy@example.com",
            NormalizedUserName = "LEGACY@EXAMPLE.COM",
            Email = "legacy@example.com",
            NormalizedEmail = "LEGACY@EXAMPLE.COM"
        };
        db.Users.Add(user);
        var dataset = CreateDataset(user.Id, "Legacy data");
        db.Datasets.Add(dataset);
        var report = new SavedReport
        {
            DatasetId = dataset.Id,
            Name = "Legacy revenue",
            ChartType = "bar",
            QueryJson = """{"groupByPosition":null,"metrics":[{"function":"count","columnPosition":null}]}"""
        };
        db.SavedReports.Add(report);
        await db.SaveChangesAsync();

        await migrator.MigrateAsync();
        var migrated = await db.SavedCharts.AsNoTracking().SingleAsync(chart => chart.Id == report.Id);
        Assert.Equal(user.Id, migrated.OwnerId);
        Assert.Equal(dataset.Id, migrated.DatasetId);
        Assert.Equal(report.Name, migrated.Name);
        Assert.Equal(report.QueryJson, migrated.QueryJson);
    }

    private static Dataset CreateDataset(string ownerId, string name) => new()
    {
        Name = name,
        FileName = $"{name}.csv",
        CreatedById = ownerId,
        Columns = [new DatasetColumn { Position = 0, Name = "Revenue", TypeName = "decimal", IsNullable = true }]
    };

    private static SavedChartRequest CreateChart(Guid datasetId, string name) => new(
        name,
        string.Empty,
        datasetId,
        "bar",
        new DatasetAnalyticsRequest(null, [new AnalyticsMetric("sum", 0)], [], 10),
        new ChartVisualOptions());

    private static async Task<AuthResponse> RegisterAsync(HttpClient client, string label)
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
        return auth;
    }

    private sealed record AuthResponse(string AccessToken, TestUser User);
    private sealed record TestUser(string Id, string Email, string FirstName, string LastName);
}

internal sealed class DataLensApiFactory(string connectionString) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureLogging(logging => logging.AddConsole().SetMinimumLevel(LogLevel.Error));
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = connectionString,
            ["Jwt:Issuer"] = "DataLens.Tests",
            ["Jwt:Audience"] = "DataLens.Tests",
            ["Jwt:SigningKey"] = "A-private-test-signing-key-with-32-characters-minimum"
        }));
    }
}
