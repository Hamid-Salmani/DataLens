using DataLens.Api;
using DataLens.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DataLens.Tests;

public sealed class DevelopmentDataSeederTests(TestDatabaseFixture fixture) : IClassFixture<TestDatabaseFixture>
{
    [Fact]
    public async Task Seeds_one_real_5000_row_demo_dataset_with_six_chart_types_and_a_dashboard()
    {
        await using var initialize = fixture.CreateContext();
        using var factory = new DataLens.Tests.Analytics.DataLensApiFactory(fixture.ConnectionString);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = fixture.ConnectionString
        }).Build();

        await DevelopmentDataSeeder.SeedAsync(factory.Services, configuration);
        await DevelopmentDataSeeder.SeedAsync(factory.Services, configuration);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var demo = await db.Users.SingleAsync(user => user.Email == DevelopmentDataSeeder.DefaultDemoEmail);
        var dataset = await db.Datasets.Include(item => item.Columns)
            .SingleAsync(item => item.CreatedById == demo.Id);
        Assert.Equal(5_000, dataset.RowCount);
        Assert.Equal(9, dataset.Columns.Count);
        var charts = await db.SavedCharts.Where(chart => chart.OwnerId == demo.Id).ToArrayAsync();
        Assert.Equal(6, charts.Length);
        Assert.Equal(6, charts.Select(chart => chart.ChartType).Distinct().Count());
        var dashboard = await db.Dashboards.Include(item => item.Widgets)
            .SingleAsync(item => item.OwnerId == demo.Id && item.IsDefault);
        Assert.Equal(6, dashboard.Widgets.Count);

        var importer = scope.ServiceProvider.GetRequiredService<DataLens.Infrastructure.Imports.DatasetCsvImporter>();
        await importer.DropTableAsync(dataset.Id, CancellationToken.None);
    }
}
