using DataLens.Api.Analytics;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Imports;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;

namespace DataLens.Tests.Analytics;

public sealed class DatasetAnalyticsServiceTests(TestDatabaseFixture fixture) : IClassFixture<TestDatabaseFixture>
{
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

        var injection = request with
        {
            GroupByPosition = null,
            GroupByPositions = null,
            Metrics = [new AnalyticsMetric("count", null)],
            Filters = [new AnalyticsFilter(6, "eq", "'; DROP TABLE [data].[ds_" + imported.Dataset.Id.ToString("N") + "];--")]
        };
        var safeResult = await service.ExecuteAsync(imported.Dataset, injection, CancellationToken.None);
        Assert.Equal(0L, Convert.ToInt64(Assert.Single(safeResult.Rows)["m0"], System.Globalization.CultureInfo.InvariantCulture));

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
}
