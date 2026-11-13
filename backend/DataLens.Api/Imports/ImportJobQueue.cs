using System.Threading.Channels;

namespace DataLens.Api.Imports;

public sealed class ImportJobQueue
{
    private readonly Channel<Guid> _jobs;

    public ImportJobQueue(IConfiguration configuration)
    {
        var capacity = Math.Clamp(configuration.GetValue("ImportJobs:QueueCapacity", 100), 1, 10_000);
        _jobs = Channel.CreateBounded<Guid>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false
        });
    }

    public bool TryEnqueue(Guid jobId) => _jobs.Writer.TryWrite(jobId);

    public IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken cancellationToken) =>
        _jobs.Reader.ReadAllAsync(cancellationToken);

    public int WorkerCount(IConfiguration configuration) =>
        Math.Clamp(configuration.GetValue("ImportJobs:Concurrency", 2), 1, 8);
}
