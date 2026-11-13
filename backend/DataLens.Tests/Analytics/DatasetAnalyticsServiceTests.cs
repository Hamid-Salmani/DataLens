using DataLens.Api.Analytics;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Imports;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;

namespace DataLens.Tests.Analytics;

public sealed class DatasetAnalyticsServiceTests(TestDatabaseFixture fixture) : IClassFixture<TestDatabaseFixture>
{
    [Fact]
    public async Task Calculates_a_previous_period_comparison_and_daily_sparkline_from_the_sales_csv()
    {
        await using var db = fixture.CreateContext();
        var user = new AppUser { UserName = $"kpi-{Guid.NewGuid():N}@example.com", Email = $"kpi-{Guid.NewGuid():N}@example.com", FirstName = "Kpi", LastName = "Tester" };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var importer = new DatasetCsvImporter(
            db,
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
            }).Build());
        var fixturePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "sales_with_errors.csv");
        await using var csv = File.OpenRead(fixturePath);
        var imported = await importer.ImportAsync(csv, "sales_with_errors.csv", "KPI sales fixture", user.Id, CancellationToken.None);
        var service = new DatasetAnalyticsService(
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
            }).Build(),
            new MemoryCache(new MemoryCacheOptions()));
        var query = new DatasetAnalyticsRequest(
            null,
            [new AnalyticsMetric("sum", 3)],
            TopN: 500,
            SortBy: "m0",
            ComparisonDatePosition: 4);

        var result = await service.ExecuteForChartAsync(
            imported.Dataset,
            query,
            new AnalyticsDateRange(new DateOnly(2025, 1, 4), new DateOnly(2025, 1, 6)),
            includeComparison: true,
            CancellationToken.None);

        Assert.True(result.DateFilterApplicable);
        Assert.Equal(304m, Convert.ToDecimal(Assert.Single(result.Result.Rows)["m0"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.NotNull(result.Comparison);
        Assert.Equal(119.5m, result.Comparison.PreviousValue);
        Assert.Equal((304m - 119.5m) / 119.5m * 100m, result.Comparison.PercentChange);
        Assert.Equal([77.5m, 100.5m, 126m], result.Comparison.Sparkline);

        await importer.DropTableAsync(imported.Dataset.Id, CancellationToken.None);
    }

    [Fact]
    public async Task Executes_multiple_groups_metrics_and_parameterized_filters_for_the_sales_fixture()
    {
        await using var db = fixture.CreateContext();
        var user = new AppUser { UserName = $"chart-{Guid.NewGuid():N}@example.com", Email = $"chart-{Guid.NewGuid():N}@example.com", FirstName = "Chart", LastName = "Tester" };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var importer = new DatasetCsvImporter(
            db,
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
            }).Build());
        var fixturePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "sales_with_errors.csv");
        await using var csv = File.OpenRead(fixturePath);
        var imported = await importer.ImportAsync(csv, "sales_with_errors.csv", "Sales fixture", user.Id, CancellationToken.None);

        var service = new DatasetAnalyticsService(
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
            }).Build(),
            new MemoryCache(new MemoryCacheOptions()));
        var request = new DatasetAnalyticsRequest(
            GroupByPosition: null,
            Metrics:
            [
                new AnalyticsMetric("sum", 3),
                new AnalyticsMetric("count", null)
            ],
            Filters:
            [
                new AnalyticsFilter(6, "eq", "West"),
                new AnalyticsFilter(4, "gte", "2025-01-01"),
                new AnalyticsFilter(5, "eq", "false")
            ],
            TopN: 50,
            GroupByPositions: [5, 6],
            SortBy: "m0",
            SortDirection: "desc");

        var result = await service.ExecuteAsync(imported.Dataset, request, CancellationToken.None);

        Assert.Equal(["groupValue", "groupValue1", "m0", "m1"], result.Columns.Select(column => column.Key));
        var west = Assert.Single(result.Rows);
        Assert.Equal("West", west["groupValue1"]?.ToString());
        Assert.Equal(42L, Convert.ToInt64(west["m1"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(3341m, Convert.ToDecimal(west["m0"], System.Globalization.CultureInfo.InvariantCulture));

        var attacks = new[]
        {
            new AnalyticsFilter(6, "eq", "' OR 1=1--"),
            new AnalyticsFilter(6, "eq", $"'; DROP TABLE [data].[ds_{imported.Dataset.Id:N}];--"),
            new AnalyticsFilter(6, "contains", "%' OR 1=1--"),
            new AnalyticsFilter(6, "startswith", $"_'; DROP TABLE [data].[ds_{imported.Dataset.Id:N}];--")
        };
        foreach (var attack in attacks)
        {
            var safeResult = await service.ExecuteAsync(imported.Dataset, new DatasetAnalyticsRequest(
                null,
                [new AnalyticsMetric("count", null)],
                [attack]), CancellationToken.None);
            Assert.Equal(0L, Convert.ToInt64(Assert.Single(safeResult.Rows)["m0"], System.Globalization.CultureInfo.InvariantCulture));
        }

        await using var verifyTable = new Microsoft.Data.SqlClient.SqlConnection(fixture.ConnectionString);
        await verifyTable.OpenAsync();
        await using var tableExists = verifyTable.CreateCommand();
        tableExists.CommandText = "SELECT OBJECT_ID(@tableName, N'U')";
        tableExists.Parameters.AddWithValue("@tableName", $"data.ds_{imported.Dataset.Id:N}");
        Assert.NotNull(await tableExists.ExecuteScalarAsync());

        await importer.DropTableAsync(imported.Dataset.Id, CancellationToken.None);
    }

    [Fact]
    public void Rejects_untrusted_sort_identifiers_before_query_execution()
    {
        var dataset = new Dataset
        {
            Id = Guid.NewGuid(),
            Columns = [new DatasetColumn { Position = 0, Name = "Amount", TypeName = "decimal" }]
        };
        var service = new DatasetAnalyticsService(
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
            }).Build(),
            new MemoryCache(new MemoryCacheOptions()));

        var error = Assert.Throws<InvalidDataException>(() => service.Validate(
            dataset,
            new DatasetAnalyticsRequest(null, [new AnalyticsMetric("sum", 0)], SortBy: "m0]; DROP TABLE Users;--")));

        Assert.Contains("result column", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Reports_a_cache_miss_then_a_hit_and_a_miss_for_changed_query()
    {
        await using var db = fixture.CreateContext();
        var user = new AppUser { UserName = $"cache-{Guid.NewGuid():N}@example.com", Email = $"cache-{Guid.NewGuid():N}@example.com", FirstName = "Cache", LastName = "Tester" };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var importer = new DatasetCsvImporter(
            db,
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
            }).Build());
        var fixturePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "sales_with_errors.csv");
        await using var csv = File.OpenRead(fixturePath);
        var imported = await importer.ImportAsync(csv, "sales_with_errors.csv", "Cache fixture", user.Id, CancellationToken.None);
        var service = new DatasetAnalyticsService(
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
            }).Build(),
            new MemoryCache(new MemoryCacheOptions()));
        var request = new DatasetAnalyticsRequest(null, [new AnalyticsMetric("count", null)]);

        var first = await service.ExecuteWithDiagnosticsAsync(imported.Dataset, request, CancellationToken.None);
        var second = await service.ExecuteWithDiagnosticsAsync(imported.Dataset, request, CancellationToken.None);
        var changed = await service.ExecuteWithDiagnosticsAsync(imported.Dataset, request with
        {
            Filters = [new AnalyticsFilter(6, "eq", "West")]
        }, CancellationToken.None);

        Assert.Equal("MISS", first.CacheStatus);
        Assert.Equal("HIT", second.CacheStatus);
        Assert.Equal("MISS", changed.CacheStatus);
        Assert.Equal(first.Result.Rows, second.Result.Rows);
        await importer.DropTableAsync(imported.Dataset.Id, CancellationToken.None);
    }
}
