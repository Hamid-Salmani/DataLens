using DataLens.Api.Imports;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace DataLens.Tests.Imports;

public sealed class ImportJobNotifierTests
{
    [Fact]
    public async Task Sends_progress_to_the_importing_users_SignalR_identity()
    {
        var clients = Substitute.For<IHubClients>();
        var client = Substitute.For<IClientProxy>();
        var context = Substitute.For<IHubContext<ImportJobHub>>();
        var jobId = Guid.NewGuid();
        var job = new ImportJobStatusDto(
            jobId,
            Guid.NewGuid(),
            "Signals",
            "Running",
            42,
            420,
            3,
            null,
            DateTime.UtcNow,
            DateTime.UtcNow,
            null,
            "owner-123");
        clients.User(job.CreatedById).Returns(client);
        context.Clients.Returns(clients);
        var notifier = new SignalRImportJobNotifier(context, NullLogger<SignalRImportJobNotifier>.Instance);

        await notifier.ProgressAsync(job, CancellationToken.None);

        clients.Received(1).User(job.CreatedById);
        await client.Received(1).SendCoreAsync(
            "JobProgress",
            Arg.Is<object?[]>(arguments => arguments.Length == 1 && ReferenceEquals(arguments[0], job)),
            CancellationToken.None);
    }
}
