using System.Globalization;
using System.Text;
using System.Text.Json;
using DataLens.Api.Analytics;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using DataLens.Infrastructure.Imports;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Api;

public static class DevelopmentDataSeeder
{
    public const string DefaultDemoEmail = "demo@datalens.local";
    public const string DefaultDemoPassword = "DemoPassword123!";

    public static async Task SeedAsync(IServiceProvider services, IConfiguration configuration, CancellationToken cancellationToken = default)
    {
        var users = services.GetRequiredService<UserManager<AppUser>>();
        var db = services.GetRequiredService<AppDbContext>();
        var email = configuration["DemoAccount:Email"] ?? DefaultDemoEmail;
        if (await users.FindByEmailAsync(email) is not null) return;

        var user = new AppUser
        {
            UserName = email,
            Email = email,
            EmailConfirmed = true,
            FirstName = "Demo",
            LastName = "Analyst"
        };
        var createResult = await users.CreateAsync(user, configuration["DemoAccount:Password"] ?? DefaultDemoPassword);
        if (!createResult.Succeeded)
        {
            throw new InvalidOperationException($"Could not create the development demo user: {string.Join("; ", createResult.Errors.Select(error => error.Description))}");
        }

        var importer = services.GetRequiredService<DatasetCsvImporter>();
        await using var csv = BuildDemoCsv();
        var imported = await importer.ImportAsync(csv, "demo-sales.csv", "Demo sales", user.Id, cancellationToken);
        var now = DateTime.UtcNow;
        var charts = BuildCharts(user.Id, imported.Dataset, now);
        db.SavedCharts.AddRange(charts);
        var dashboard = new Dashboard
        {
            OwnerId = user.Id,
            Name = "Sales overview",
            IsDefault = true,
            CreatedAt = now,
            UpdatedAt = now
        };
        var placements = new (int X, int Y, int Width, int Height)[]
        {
            (0, 0, 4, 3), (4, 0, 4, 4), (8, 0, 4, 4),
            (0, 4, 6, 4), (6, 4, 6, 4), (0, 8, 12, 4)
        };
        dashboard.Widgets = charts.Select((chart, index) => new DashboardWidget
        {
            Dashboard = dashboard,
            SavedChart = chart,
            X = placements[index].X,
            Y = placements[index].Y,
            Width = placements[index].Width,
            Height = placements[index].Height
        }).ToList();
        db.Dashboards.Add(dashboard);
        await db.SaveChangesAsync(cancellationToken);
    }

    private static MemoryStream BuildDemoCsv()
    {
        var stream = new MemoryStream();
        using (var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true))
        {
            writer.WriteLine("order_id,order_date,region,category,product,quantity,unit_price,total_amount,is_returned");
            var random = new Random(20261113);
            string[] regions = ["West", "East", "North", "South"];
            string[] categories = ["Accessories", "Appliances", "Furniture", "Office"];
            string[] products = ["Desk", "Lamp", "Chair", "Monitor", "Keyboard", "Printer", "Shelf"];
            var start = DateTime.UtcNow.Date.AddDays(-89);
            for (var index = 1; index <= 5_000; index++)
            {
                var quantity = random.Next(1, 8);
                var unitPrice = random.Next(12, 950) + random.Next(0, 100) / 100m;
                var orderDate = start.AddDays(random.Next(0, 90));
                var amount = decimal.Round(quantity * unitPrice, 2);
                writer.Write(index.ToString(CultureInfo.InvariantCulture));
                writer.Write(',');
                writer.Write(orderDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
                writer.Write(',');
                writer.Write(regions[random.Next(regions.Length)]);
                writer.Write(',');
                writer.Write(categories[random.Next(categories.Length)]);
                writer.Write(',');
                writer.Write(products[random.Next(products.Length)]);
                writer.Write(',');
                writer.Write(quantity.ToString(CultureInfo.InvariantCulture));
                writer.Write(',');
                writer.Write(unitPrice.ToString("0.00", CultureInfo.InvariantCulture));
                writer.Write(',');
                writer.Write(amount.ToString("0.00", CultureInfo.InvariantCulture));
                writer.Write(',');
                writer.WriteLine(random.NextDouble() < 0.06 ? "true" : "false");
            }
            writer.Flush();
        }
        stream.Position = 0;
        return stream;
    }

    private static SavedChart[] BuildCharts(string ownerId, Dataset dataset, DateTime now)
    {
        var specs = new (string Name, string Type, DatasetAnalyticsRequest Query, bool GoodDown)[]
        {
            ("Revenue KPI", "kpi", Query(null, [new AnalyticsMetric("sum", 7)], comparisonPosition: 1), false),
            ("Revenue trend", "line", Query(null, [new AnalyticsMetric("sum", 7)], timePosition: 1, timeBucket: "day"), false),
            ("Revenue by region", "bar", Query(2, [new AnalyticsMetric("sum", 7)]), false),
            ("Sales mix", "donut", Query(3, [new AnalyticsMetric("sum", 7)]), false),
            ("Orders by category and returns", "stacked-bar", Query(null, [new AnalyticsMetric("count", null)], groups: [3, 8]), true),
            ("Orders by region", "table", Query(2, [new AnalyticsMetric("count", null)]), false)
        };
        return specs.Select(spec => new SavedChart
        {
            OwnerId = ownerId,
            DatasetId = dataset.Id,
            Dataset = dataset,
            Name = spec.Name,
            Description = "Development demonstration chart",
            ChartType = spec.Type,
            QueryJson = JsonSerializer.Serialize(spec.Query),
            OptionsJson = JsonSerializer.Serialize(new ChartVisualOptions(
                Title: spec.Name,
                ShowLegend: true,
                Stacked: spec.Type == "stacked-bar",
                NumberFormat: "currency",
                GoodDirection: spec.GoodDown ? "down" : "up")),
            CreatedAt = now,
            UpdatedAt = now
        }).ToArray();
    }

    private static DatasetAnalyticsRequest Query(
        int? group,
        AnalyticsMetric[] metrics,
        int[]? groups = null,
        int? timePosition = null,
        string? timeBucket = null,
        int? comparisonPosition = null) =>
        new(group, metrics, [], 100, groups ?? (group is int position ? [position] : []),
            timePosition is null ? "m0" : "groupValue", "asc", timePosition, timeBucket, comparisonPosition);
}
