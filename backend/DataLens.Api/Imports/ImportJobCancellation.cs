using System.Collections.Concurrent;

namespace DataLens.Api.Imports;

public sealed class ImportJobCancellation
{
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _activeJobs = new();

    public CancellationTokenSource Start(Guid jobId, CancellationToken applicationStopping)
    {
        var cancellation = CancellationTokenSource.CreateLinkedTokenSource(applicationStopping);
        if (!_activeJobs.TryAdd(jobId, cancellation))
        {
            cancellation.Dispose();
            throw new InvalidOperationException($"Import job {jobId} is already running.");
        }

        return cancellation;
    }

    public bool Cancel(Guid jobId)
    {
        if (!_activeJobs.TryGetValue(jobId, out var cancellation))
        {
            return false;
        }

        try
        {
            cancellation.Cancel();
            return true;
        }
        catch (ObjectDisposedException)
        {
            return false;
        }
    }

    public void Complete(Guid jobId)
    {
        if (_activeJobs.TryRemove(jobId, out var cancellation))
        {
            cancellation.Dispose();
        }
    }
}
