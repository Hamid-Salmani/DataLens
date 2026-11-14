using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace DataLens.Api.Imports;

[Authorize]
public sealed class ImportJobHub : Hub;
