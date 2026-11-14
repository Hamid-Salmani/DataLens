using System.Globalization;
using System.Text;
using DataLens.Domain.Entities;
using DataLens.Api.Analytics;
using DataLens.Infrastructure.Data;
using DataLens.Infrastructure.Imports;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace DataLens.Api.Exports;

public sealed class ExportJobProcessingService(
    ExportJobQueue queue,
    ExportFileStore fileStore,
    DatasetAnalyticsService analytics,
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration,
    ILogger<ExportJobProcessingService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await MarkInterruptedJobsAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var jobId = await queue.DequeueAsync(stoppingToken);
                await ProcessAsync(jobId, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task MarkInterruptedJobsAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var interrupted = await db.ExportJobs
            .Where(job => job.Status == ExportJobStatus.Queued || job.Status == ExportJobStatus.Running)
            .ToListAsync(cancellationToken);

        foreach (var job in interrupted)
        {
            job.Status = ExportJobStatus.Failed;
            job.ErrorMessage = "The application restarted before this export finished. Create it again.";
            job.CompletedAt = DateTime.UtcNow;
        }

        if (interrupted.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            logger.LogWarning("Marked {Count} interrupted export jobs as failed after startup.", interrupted.Count);
        }
    }

    private async Task ProcessAsync(Guid jobId, CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.ExportJobs
            .Include(item => item.Dataset).ThenInclude(dataset => dataset!.Columns)
            .Include(item => item.SavedChart).ThenInclude(chart => chart!.Dataset).ThenInclude(dataset => dataset!.Columns)
            .Include(item => item.Dashboard).ThenInclude(dashboard => dashboard!.Widgets)
                .ThenInclude(widget => widget.SavedChart).ThenInclude(chart => chart!.Dataset).ThenInclude(dataset => dataset!.Columns)
            .SingleOrDefaultAsync(item => item.Id == jobId, cancellationToken);
        if (job is null || job.Status != ExportJobStatus.Queued) return;

        try
        {
            job.Status = ExportJobStatus.Running;
            job.Progress = 1;
            await db.SaveChangesAsync(cancellationToken);
            fileStore.EnsureDirectory();
            var outputPath = fileStore.GetPath(job);
            switch (job.Type)
            {
                case ExportJobType.DatasetCsv:
                    if (job.Dataset is null) throw new InvalidDataException("The dataset for this export no longer exists.");
                    await WriteCsvAsync(job, outputPath, cancellationToken);
                    break;
                case ExportJobType.ChartPdf:
                case ExportJobType.DashboardPdf:
                    await WritePdfAsync(job, outputPath, cancellationToken);
                    break;
                default:
                    throw new InvalidDataException("The export type is not supported.");
            }
            job.Status = ExportJobStatus.Completed;
            job.Progress = 100;
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogError(exception, "Export job {ExportJobId} failed.", job.Id);
            job.Status = ExportJobStatus.Failed;
            job.ErrorMessage = "The export could not be completed.";
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            fileStore.Delete(job);
        }
    }

    private async Task WritePdfAsync(ExportJob job, string outputPath, CancellationToken cancellationToken)
    {
        var charts = job.Type switch
        {
            ExportJobType.ChartPdf when job.SavedChart is not null =>
                new[] { (Chart: job.SavedChart, Title: GetChartTitle(job.SavedChart)) },
            ExportJobType.DashboardPdf when job.Dashboard is not null =>
                job.Dashboard.Widgets
                    .OrderBy(widget => widget.Y).ThenBy(widget => widget.X)
                    .Where(widget => widget.SavedChart is not null)
                    .Select(widget => (Chart: widget.SavedChart!, Title: GetWidgetTitle(widget)))
                    .ToArray(),
            _ => throw new InvalidDataException("The chart or dashboard for this export no longer exists.")
        };
        var range = job.FromDate is DateOnly from && job.ToDate is DateOnly to
            ? new AnalyticsDateRange(from, to)
            : null;
        var sections = new List<PdfExportSection>(charts.Length);
        for (var index = 0; index < charts.Length; index++)
        {
            var (chart, title) = charts[index];
            var dataset = chart.Dataset ?? throw new InvalidDataException("A chart dataset for this export no longer exists.");
            var query = JsonSerializer.Deserialize<DatasetAnalyticsRequest>(chart.QueryJson)
                ?? throw new InvalidDataException("A saved chart query is invalid.");
            var execution = await analytics.ExecuteForChartAsync(
                dataset,
                query,
                range,
                chart.ChartType == "kpi",
                cancellationToken);
            sections.Add(new PdfExportSection(
                title,
                dataset.Name,
                chart.ChartType,
                execution.Result,
                execution.Comparison));
            await SaveProgressAsync(job.Id, 1 + (int)((index + 1) * 98L / charts.Length), cancellationToken);
        }

        AnalyticsPdfDocument.Generate(outputPath, job.TargetName, job.FromDate, job.ToDate, sections);
    }

    private static string GetWidgetTitle(DashboardWidget widget)
    {
        if (!string.IsNullOrWhiteSpace(widget.TitleOverride)) return widget.TitleOverride;
        return GetChartTitle(widget.SavedChart!);
    }

    private static string GetChartTitle(SavedChart chart)
    {
        try
        {
            var options = JsonSerializer.Deserialize<ChartVisualOptions>(chart.OptionsJson)
                ?? throw new InvalidDataException("A saved chart has invalid visual options.");
            if (!string.IsNullOrWhiteSpace(options?.Title)) return options.Title;
        }
        catch (JsonException)
        {
            throw new InvalidDataException("A saved chart has invalid visual options.");
        }
        return chart.Name;
    }

    private async Task WriteCsvAsync(ExportJob job, string outputPath, CancellationToken cancellationToken)
    {
        var columns = job.Dataset!.Columns.OrderBy(column => column.Position).ToArray();
        if (columns.Length == 0) throw new InvalidDataException("The dataset has no columns to export.");
        var select = string.Join(", ", columns.Select(column => $"[c{column.Position}]"));
        await using var connection = new SqlConnection(configuration.GetConnectionString("DefaultConnection"));
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {select} FROM {DatasetCsvImporter.GetTableName(job.Dataset!.Id)};";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await using var writer = new StreamWriter(outputPath, false, new UTF8Encoding(false));
        await writer.WriteLineAsync(string.Join(',', columns.Select(column => EscapeCsv(column.Name))));

        long rowCount = 0;
        var lastSavedProgress = 1;
        while (await reader.ReadAsync(cancellationToken))
        {
            var fields = new string[columns.Length];
            for (var index = 0; index < columns.Length; index++)
            {
                fields[index] = EscapeCsv(reader.IsDBNull(index)
                    ? string.Empty
                    : FormatValue(reader.GetValue(index), columns[index].TypeName));
            }
            await writer.WriteLineAsync(string.Join(',', fields));
            rowCount++;

            if (rowCount % 500 == 0)
            {
                        var progress = job.Dataset.RowCount == 0
                    ? 50
                    : Math.Min(99, 1 + (int)(rowCount * 98 / job.Dataset.RowCount));
                if (progress != lastSavedProgress)
                {
                    job.Progress = progress;
                    await SaveProgressAsync(job.Id, progress, cancellationToken);
                    lastSavedProgress = progress;
                }
            }
        }
        await writer.FlushAsync(cancellationToken);
    }

    private async Task SaveProgressAsync(Guid jobId, int progress, CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.ExportJobs.Where(item => item.Id == jobId && item.Status == ExportJobStatus.Running)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.Progress, progress), cancellationToken);
    }

    private static string FormatValue(object value, string typeName) => typeName switch
    {
        "date" => Convert.ToDateTime(value, CultureInfo.InvariantCulture).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        "datetime" => Convert.ToDateTime(value, CultureInfo.InvariantCulture).ToString("O", CultureInfo.InvariantCulture),
        "boolean" => Convert.ToBoolean(value, CultureInfo.InvariantCulture) ? "true" : "false",
        "integer" => Convert.ToInt64(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture),
        "decimal" or "number" => Convert.ToDecimal(value, CultureInfo.InvariantCulture).ToString("G29", CultureInfo.InvariantCulture),
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty
    };

    private static string EscapeCsv(string value) => $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
}
