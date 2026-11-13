using System.Security.Claims;
using DataLens.Api.Extensions;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Api.Exports;

public static class ExportEndpoints
{
    public static void MapExportEndpoints(this WebApplication app)
    {
        var exports = app.MapGroup("/api/exports").RequireAuthorization();

        exports.MapGet("/", async (ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var items = await db.ExportJobs.AsNoTracking().Include(item => item.Dataset)
                .Where(item => item.OwnerId == userId).OrderByDescending(item => item.CreatedAt).Take(100)
                .ToListAsync(cancellationToken);
            return Results.Ok(items.Select(item => ToResponse(item)));
        });

        exports.MapPost("/", async (
            ExportRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            ExportJobQueue queue,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var dataset = await db.Datasets.AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == request.DatasetId && item.CreatedById == userId, cancellationToken);
            if (dataset is null) return Results.NotFound();
            var job = new ExportJob
            {
                OwnerId = userId,
                DatasetId = dataset.Id,
                TargetName = dataset.Name,
                FileName = $"{SafeFileName(dataset.Name)}.csv",
                Type = ExportJobType.DatasetCsv
            };
            return await QueueAsync(job, db, queue, cancellationToken);
        });

        exports.MapPost("/charts/{chartId:guid}", async (
            Guid chartId,
            PdfExportRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            ExportJobQueue queue,
            CancellationToken cancellationToken) =>
        {
            if (!ValidDateRange(request.From, request.To))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["dateRange"] = ["Both dates are required, and the start must not be after the end."] });
            var userId = ApiUserIdentity.GetUserId(principal);
            var chart = await db.SavedCharts.AsNoTracking().Include(item => item.Dataset)
                .SingleOrDefaultAsync(item => item.Id == chartId && item.OwnerId == userId, cancellationToken);
            if (chart?.Dataset is null) return Results.NotFound();
            var job = new ExportJob
            {
                OwnerId = userId,
                DatasetId = chart.DatasetId,
                SavedChartId = chart.Id,
                FromDate = request.From,
                ToDate = request.To,
                Type = ExportJobType.ChartPdf,
                TargetName = chart.Name,
                FileName = $"{SafeFileName(chart.Name)}.pdf"
            };
            return await QueueAsync(job, db, queue, cancellationToken);
        });

        exports.MapPost("/dashboards/{dashboardId:guid}", async (
            Guid dashboardId,
            PdfExportRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            ExportJobQueue queue,
            CancellationToken cancellationToken) =>
        {
            if (!ValidDateRange(request.From, request.To))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["dateRange"] = ["Both dates are required, and the start must not be after the end."] });
            var userId = ApiUserIdentity.GetUserId(principal);
            var dashboard = await db.Dashboards.AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == dashboardId && item.OwnerId == userId, cancellationToken);
            if (dashboard is null) return Results.NotFound();
            var job = new ExportJob
            {
                OwnerId = userId,
                DashboardId = dashboard.Id,
                FromDate = request.From,
                ToDate = request.To,
                Type = ExportJobType.DashboardPdf,
                TargetName = dashboard.Name,
                FileName = $"{SafeFileName(dashboard.Name)}.pdf"
            };
            return await QueueAsync(job, db, queue, cancellationToken);
        });

        exports.MapGet("/{id:guid}", async (
            Guid id,
            ClaimsPrincipal principal,
            AppDbContext db,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var job = await db.ExportJobs.AsNoTracking().Include(item => item.Dataset)
                .SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);
            return job is null ? Results.NotFound() : Results.Ok(ToResponse(job));
        });

        exports.MapGet("/{id:guid}/download", async (
            Guid id,
            ClaimsPrincipal principal,
            AppDbContext db,
            ExportFileStore fileStore,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var job = await db.ExportJobs.AsNoTracking().SingleOrDefaultAsync(
                item => item.Id == id && item.OwnerId == userId, cancellationToken);
            if (job is null) return Results.NotFound();
            if (job.Status != ExportJobStatus.Completed) return Results.Conflict(new { detail = "This export is not ready to download." });
            var path = fileStore.GetPath(job);
            var contentType = job.Type == ExportJobType.DatasetCsv ? "text/csv; charset=utf-8" : "application/pdf";
            return !File.Exists(path)
                ? Results.Problem("The export file is no longer available.", statusCode: StatusCodes.Status410Gone)
                : Results.File(path, contentType, job.FileName);
        });

        exports.MapDelete("/{id:guid}", async (
            Guid id,
            ClaimsPrincipal principal,
            AppDbContext db,
            ExportFileStore fileStore,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var job = await db.ExportJobs.SingleOrDefaultAsync(
                item => item.Id == id && item.OwnerId == userId, cancellationToken);
            if (job is null) return Results.NotFound();
            if (job.Status == ExportJobStatus.Running)
                return Results.Conflict(new { detail = "A running export cannot be deleted yet." });
            fileStore.Delete(job);
            db.ExportJobs.Remove(job);
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        });
    }

    private static async Task<IResult> QueueAsync(
        ExportJob job,
        AppDbContext db,
        ExportJobQueue queue,
        CancellationToken cancellationToken)
    {
        db.ExportJobs.Add(job);
        await db.SaveChangesAsync(cancellationToken);
        if (!queue.TryEnqueue(job.Id))
        {
            job.Status = ExportJobStatus.Failed;
            job.ErrorMessage = "The export queue is full. Try again shortly.";
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return Results.Problem(job.ErrorMessage, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        return Results.Accepted($"/api/exports/{job.Id}", ToResponse(job));
    }

    private static bool ValidDateRange(DateOnly? from, DateOnly? to) =>
        from.HasValue == to.HasValue && (!from.HasValue || from.Value <= to!.Value);

    private static string SafeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars().Concat("<>:\"/\\|?*".ToCharArray()).ToHashSet();
        var safe = new string(name.Trim().Where(character => !char.IsControl(character) && !invalid.Contains(character)).ToArray()).Trim(' ', '.');
        return string.IsNullOrWhiteSpace(safe) ? "DataLens export" : safe[..Math.Min(safe.Length, 180)];
    }

    private static ExportJobResponse ToResponse(ExportJob job, string? datasetName = null) =>
        new(job.Id, job.DatasetId, datasetName ?? job.Dataset?.Name ?? string.Empty, job.TargetName,
            job.FileName, job.Type.ToString(), job.Status.ToString(), job.Progress, job.ErrorMessage,
            job.CreatedAt, job.CompletedAt);
}

public sealed record ExportRequest(Guid DatasetId);
public sealed record PdfExportRequest(DateOnly? From = null, DateOnly? To = null);
public sealed record ExportJobResponse(
    Guid Id,
    Guid? DatasetId,
    string DatasetName,
    string TargetName,
    string FileName,
    string Type,
    string Status,
    int Progress,
    string? ErrorMessage,
    DateTime CreatedAt,
    DateTime? CompletedAt);
