using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using DataLens.Infrastructure.Imports;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Api.Imports;

public sealed class ImportJobProcessingService(
    IServiceScopeFactory scopeFactory,
    ImportJobQueue queue,
    ImportJobCancellation cancellation,
    ImportFileStore fileStore,
    IImportJobNotifier notifier,
    IConfiguration configuration,
    ILogger<ImportJobProcessingService> logger) : BackgroundService
{
    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await MarkInterruptedJobsAsync(cancellationToken);
        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var workers = Enumerable.Range(0, queue.WorkerCount(configuration))
            .Select(_ => ConsumeQueueAsync(stoppingToken));
        await Task.WhenAll(workers);
    }

    private async Task MarkInterruptedJobsAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var interrupted = await db.ImportJobs
            .Where(job => job.Status == JobStatus.Queued || job.Status == JobStatus.Running)
            .ToListAsync(cancellationToken);

        foreach (var job in interrupted)
        {
            job.Status = JobStatus.Failed;
            job.ErrorMessage = "The application restarted before this import finished. Retry the job to resume.";
            job.CompletedAt = DateTime.UtcNow;
        }

        if (interrupted.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task ConsumeQueueAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var jobId in queue.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await ProcessJobAsync(jobId, stoppingToken);
                }
                catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogError(exception, "Could not process import job {JobId}.", jobId);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task ProcessJobAsync(Guid jobId, CancellationToken stoppingToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<DatasetCsvImporter>();
        var job = await db.ImportJobs
            .Include(item => item.Dataset)
            .ThenInclude(dataset => dataset!.Columns)
            .SingleOrDefaultAsync(item => item.Id == jobId, stoppingToken);

        if (job is null || job.Status != JobStatus.Queued || job.Dataset is null)
        {
            return;
        }

        var jobCancellation = cancellation.Start(jobId, stoppingToken);
        try
        {
            job.Status = JobStatus.Running;
            job.StartedAt = DateTime.UtcNow;
            job.ErrorMessage = null;
            await db.SaveChangesAsync(jobCancellation.Token);
            await notifier.ProgressAsync(ToStatus(job), jobCancellation.Token);

            var path = fileStore.GetPath(jobId);
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("The saved CSV file for this job is no longer available.");
            }

            var lastDatabaseUpdate = DateTime.MinValue;
            CsvImportResult result;
            await using (var source = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 64 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                result = await importer.ImportIntoAsync(
                    source,
                    job.Dataset,
                    job.FileSizeBytes,
                    jobCancellation.Token,
                    (progress, rowsProcessed) =>
                    {
                        if (DateTime.UtcNow - lastDatabaseUpdate < TimeSpan.FromMilliseconds(250))
                        {
                            return;
                        }

                        lastDatabaseUpdate = DateTime.UtcNow;
                        job.Progress = progress;
                        job.RowsProcessed = rowsProcessed;
                        db.SaveChanges();
                        notifier.ProgressAsync(ToStatus(job), jobCancellation.Token).GetAwaiter().GetResult();
                    });
            }

            job.Progress = 100;
            job.RowsProcessed = result.Dataset.RowCount;
            job.RowsSkipped = result.RowsSkipped;
            job.Status = JobStatus.Completed;
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(jobCancellation.Token);
            await notifier.CompletedAsync(ToStatus(job), jobCancellation.Token);
            try
            {
                fileStore.Delete(jobId);
            }
            catch (IOException exception)
            {
                logger.LogWarning(exception, "Could not delete the completed import file for job {JobId}.", jobId);
            }
            catch (UnauthorizedAccessException exception)
            {
                logger.LogWarning(exception, "Could not delete the completed import file for job {JobId}.", jobId);
            }
        }
        catch (OperationCanceledException) when (jobCancellation.IsCancellationRequested)
        {
            var interruptedByShutdown = stoppingToken.IsCancellationRequested;
            job.Status = interruptedByShutdown ? JobStatus.Failed : JobStatus.Cancelled;
            job.ErrorMessage = interruptedByShutdown
                ? "The application shut down before this import finished. Retry the job to resume."
                : "The import was cancelled.";
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            if (interruptedByShutdown)
            {
                await notifier.FailedAsync(ToStatus(job), CancellationToken.None);
            }
            else
            {
                await notifier.CancelledAsync(ToStatus(job), CancellationToken.None);
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Import job {JobId} failed.", jobId);
            job.Status = JobStatus.Failed;
            job.ErrorMessage = exception switch
            {
                FileNotFoundException => "The saved CSV file for this import is unavailable.",
                InvalidDataException => exception.Message,
                _ => "The import failed because of a server error. You can retry the import."
            };
            job.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);
            await notifier.FailedAsync(ToStatus(job), CancellationToken.None);
        }
        finally
        {
            cancellation.Complete(jobId);
        }
    }

    internal static ImportJobStatusDto ToStatus(ImportJob job) =>
        new(
            job.Id,
            job.DatasetId,
            job.Dataset?.Name ?? string.Empty,
            job.Status.ToString(),
            job.Progress,
            job.RowsProcessed,
            job.RowsSkipped,
            job.ErrorMessage,
            job.CreatedAt,
            job.StartedAt,
            job.CompletedAt,
            job.CreatedById);
}
