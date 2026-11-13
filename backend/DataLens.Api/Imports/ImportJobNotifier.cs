using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.SignalR;

namespace DataLens.Api.Imports;

public interface IImportJobNotifier
{
    Task ProgressAsync(ImportJobStatusDto job, CancellationToken cancellationToken);
    Task CompletedAsync(ImportJobStatusDto job, CancellationToken cancellationToken);
    Task FailedAsync(ImportJobStatusDto job, CancellationToken cancellationToken);
    Task CancelledAsync(ImportJobStatusDto job, CancellationToken cancellationToken);
}

public sealed class SignalRImportJobNotifier(
    IHubContext<ImportJobHub> hub,
    ILogger<SignalRImportJobNotifier> logger) : IImportJobNotifier
{
    private static readonly TimeSpan MinimumProgressInterval = TimeSpan.FromMilliseconds(250);
    private readonly ConcurrentDictionary<Guid, ProgressClock> _progressClocks = new();

    public Task ProgressAsync(ImportJobStatusDto job, CancellationToken cancellationToken)
    {
        var clock = _progressClocks.GetOrAdd(job.JobId, _ => new ProgressClock());
        lock (clock.Sync)
        {
            var now = Stopwatch.GetTimestamp();
            if (clock.LastTimestamp != 0 &&
                Stopwatch.GetElapsedTime(clock.LastTimestamp, now) < MinimumProgressInterval)
            {
                return Task.CompletedTask;
            }

            clock.LastTimestamp = now;
        }

        return SendSafelyAsync(job, "JobProgress", cancellationToken);
    }

    public Task CompletedAsync(ImportJobStatusDto job, CancellationToken cancellationToken)
    {
        _progressClocks.TryRemove(job.JobId, out _);
        return SendSafelyAsync(job, "JobCompleted", cancellationToken);
    }

    public Task FailedAsync(ImportJobStatusDto job, CancellationToken cancellationToken)
    {
        _progressClocks.TryRemove(job.JobId, out _);
        return SendSafelyAsync(job, "JobFailed", cancellationToken);
    }

    public Task CancelledAsync(ImportJobStatusDto job, CancellationToken cancellationToken)
    {
        _progressClocks.TryRemove(job.JobId, out _);
        return SendSafelyAsync(job, "JobCancelled", cancellationToken);
    }

    private async Task SendSafelyAsync(ImportJobStatusDto job, string eventName, CancellationToken cancellationToken)
    {
        try
        {
            await hub.Clients.User(job.CreatedById).SendAsync(eventName, job, cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not send {EventName} for import job {JobId}.", eventName, job.JobId);
        }
    }

    private sealed class ProgressClock
    {
        public object Sync { get; } = new();
        public long LastTimestamp { get; set; }
    }
}

public sealed record ImportJobStatusDto(
    Guid JobId,
    Guid DatasetId,
    string DatasetName,
    string Status,
    int Progress,
    long RowsProcessed,
    long RowsSkipped,
    string? ErrorMessage,
    DateTime CreatedAt,
    DateTime? StartedAt,
    DateTime? CompletedAt,
    [property: JsonIgnore] string CreatedById);
