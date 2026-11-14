using System.Security.Claims;

namespace DataLens.Api.Extensions;

public static class ApiUserIdentity
{
    public static string GetUserId(ClaimsPrincipal principal) =>
        principal.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? principal.FindFirstValue("sub")
        ?? throw new UnauthorizedAccessException("The access token has no user identifier.");
}
