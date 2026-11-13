using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;
using DataLens.Api.Extensions;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Api.Analytics;

public static class SavedChartEndpoints
{
    public static void MapSavedChartEndpoints(this WebApplication app)
    {
        var charts = app.MapGroup("/api/charts").RequireAuthorization();

        charts.MapGet("/", async (ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var items = await db.SavedCharts.AsNoTracking()
                .Include(chart => chart.Dataset)
                .Where(chart => chart.OwnerId == userId)
                .OrderByDescending(chart => chart.UpdatedAt)
                .ToListAsync(cancellationToken);
            return Results.Ok(items.Select(ToResponse));
        });

        charts.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var chart = await db.SavedCharts.AsNoTracking()
                .Include(item => item.Dataset)
                .SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);
            return chart is null ? Results.NotFound() : Results.Ok(ToResponse(chart));
        });

        charts.MapPost("/", async (
            SavedChartRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            IValidator<SavedChartRequest> validator,
            DatasetAnalyticsService analytics,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid) return Results.ValidationProblem(validation.ToDictionary());

            var dataset = await db.Datasets.Include(item => item.Columns)
                .SingleOrDefaultAsync(item => item.Id == request.DatasetId && item.CreatedById == userId, cancellationToken);
            if (dataset is null) return Results.NotFound();
            var queryError = ValidateQuery(dataset, request.Query, analytics);
            if (queryError is not null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["query"] = [queryError] });

            var now = DateTime.UtcNow;
            var chart = new SavedChart
            {
                OwnerId = userId,
                DatasetId = dataset.Id,
                Name = request.Name!.Trim(),
                Description = request.Description?.Trim() ?? string.Empty,
                ChartType = request.ChartType!.ToLowerInvariant(),
                QueryJson = JsonSerializer.Serialize(request.Query),
                OptionsJson = JsonSerializer.Serialize(request.Options),
                CreatedAt = now,
                UpdatedAt = now,
                Dataset = dataset
            };
            db.SavedCharts.Add(chart);
            await db.SaveChangesAsync(cancellationToken);
            return Results.Created($"/api/charts/{chart.Id}", ToResponse(chart));
        });

        charts.MapPut("/{id:guid}", async (
            Guid id,
            SavedChartRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            IValidator<SavedChartRequest> validator,
            DatasetAnalyticsService analytics,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var chart = await db.SavedCharts.Include(item => item.Dataset)
                .SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);
            if (chart is null) return Results.NotFound();
            var validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid) return Results.ValidationProblem(validation.ToDictionary());
            if (request.DatasetId != chart.DatasetId) return Results.ValidationProblem(new Dictionary<string, string[]> { ["datasetId"] = ["A saved chart cannot be moved to another dataset."] });
            await db.Entry(chart).Reference(item => item.Dataset).Query().Include(dataset => dataset.Columns).LoadAsync(cancellationToken);
            var queryError = ValidateQuery(chart.Dataset!, request.Query, analytics);
            if (queryError is not null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["query"] = [queryError] });

            chart.Name = request.Name!.Trim();
            chart.Description = request.Description?.Trim() ?? string.Empty;
            chart.ChartType = request.ChartType!.ToLowerInvariant();
            chart.QueryJson = JsonSerializer.Serialize(request.Query);
            chart.OptionsJson = JsonSerializer.Serialize(request.Options);
            chart.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return Results.Ok(ToResponse(chart));
        });

        charts.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var chart = await db.SavedCharts.SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);
            if (chart is null) return Results.NotFound();
            var widgets = await db.DashboardWidgets.Where(item => item.SavedChartId == chart.Id).ToListAsync(cancellationToken);
            db.DashboardWidgets.RemoveRange(widgets);
            db.SavedCharts.Remove(chart);
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        });

        charts.MapPost("/preview", PreviewChartAsync);
        charts.MapGet("/{id:guid}/preview", RunSavedChartAsync);
    }

    private static async Task<IResult> PreviewChartAsync(
        ChartPreviewRequest request,
        ClaimsPrincipal principal,
        AppDbContext db,
        DatasetAnalyticsService analytics,
        HttpResponse response,
        CancellationToken cancellationToken)
    {
        var userId = ApiUserIdentity.GetUserId(principal);
        var dataset = await db.Datasets.AsNoTracking().Include(item => item.Columns)
            .SingleOrDefaultAsync(item => item.Id == request.DatasetId && item.CreatedById == userId, cancellationToken);
        if (dataset is null) return Results.NotFound();
        return await RunAnalyticsAsync(dataset, request.Query, analytics, response, cancellationToken);
    }

    private static async Task<IResult> RunSavedChartAsync(
        Guid id,
        ClaimsPrincipal principal,
        AppDbContext db,
        DatasetAnalyticsService analytics,
        HttpResponse response,
        CancellationToken cancellationToken)
    {
        var userId = ApiUserIdentity.GetUserId(principal);
        var chart = await db.SavedCharts.AsNoTracking().Include(item => item.Dataset).ThenInclude(dataset => dataset!.Columns)
            .SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);
        if (chart?.Dataset is null) return Results.NotFound();
        var query = JsonSerializer.Deserialize<DatasetAnalyticsRequest>(chart.QueryJson);
        return query is null
            ? Results.Problem("The saved chart query is invalid.", statusCode: StatusCodes.Status422UnprocessableEntity)
            : await RunAnalyticsAsync(chart.Dataset, query, analytics, response, cancellationToken);
    }

    private static async Task<IResult> RunAnalyticsAsync(
        Dataset dataset,
        DatasetAnalyticsRequest query,
        DatasetAnalyticsService analytics,
        HttpResponse response,
        CancellationToken cancellationToken)
    {
        try
        {
            var stopwatch = Stopwatch.StartNew();
            var result = await analytics.ExecuteWithDiagnosticsAsync(dataset, query, cancellationToken);
            stopwatch.Stop();
            response.Headers.CacheControl = "private, max-age=30";
            response.Headers["X-Analytics-Cache"] = result.CacheStatus;
            response.Headers["X-Analytics-Duration-Ms"] = stopwatch.Elapsed.TotalMilliseconds.ToString("F1", System.Globalization.CultureInfo.InvariantCulture);
            return Results.Ok(new ChartPreviewResponse(result.Result, result.CacheStatus, stopwatch.Elapsed.TotalMilliseconds));
        }
        catch (InvalidDataException exception)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["query"] = [exception.Message] });
        }
    }

    private static string? ValidateQuery(Dataset dataset, DatasetAnalyticsRequest? query, DatasetAnalyticsService analytics)
    {
        if (query is null) return "A valid chart query is required.";
        try
        {
            analytics.Validate(dataset, query);
            return null;
        }
        catch (InvalidDataException exception)
        {
            return exception.Message;
        }
    }

    internal static SavedChartResponse ToResponse(SavedChart chart)
    {
        var query = JsonSerializer.Deserialize<DatasetAnalyticsRequest>(chart.QueryJson)
            ?? throw new InvalidDataException("This saved chart has an invalid query.");
        var options = JsonSerializer.Deserialize<ChartVisualOptions>(chart.OptionsJson) ?? new ChartVisualOptions();
        return new SavedChartResponse(
            chart.Id, chart.DatasetId, chart.Dataset?.Name ?? string.Empty, chart.Name, chart.Description,
            chart.ChartType, query, options, chart.CreatedAt, chart.UpdatedAt, Convert.ToBase64String(chart.RowVersion));
    }
}
