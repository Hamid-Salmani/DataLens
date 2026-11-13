using System.Threading.Channels;

namespace DataLens.Api.Exports;

public sealed class ExportJobQueue
{
    private readonly Channel<Guid> _jobs = Channel.CreateBounded<Guid>(new BoundedChannelOptions(50)
    {
        FullMode = BoundedChannelFullMode.Wait,
        SingleReader = true,
        SingleWriter = false
    });

    public bool TryEnqueue(Guid jobId) => _jobs.Writer.TryWrite(jobId);

    public ValueTask<Guid> DequeueAsync(CancellationToken cancellationToken) =>
        _jobs.Reader.ReadAsync(cancellationToken);
}
