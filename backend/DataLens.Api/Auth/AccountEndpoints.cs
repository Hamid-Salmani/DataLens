using System.Security.Claims;
using DataLens.Api.Exports;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using DataLens.Infrastructure.Imports;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Api.Auth;

public static class AccountEndpoints
{
    public static void MapAccountEndpoints(this WebApplication app)
    {
        var account = app.MapGroup("/api/auth").RequireAuthorization();

        account.MapPut("/profile", async (
            ProfileUpdateRequest request,
            ClaimsPrincipal principal,
            UserManager<AppUser> users) =>
        {
            var user = await FindUserAsync(principal, users);
            if (user is null) return Results.NotFound();
            var firstName = request.FirstName?.Trim();
            var lastName = request.LastName?.Trim();
            if (string.IsNullOrWhiteSpace(firstName) || firstName.Length > 120 ||
                string.IsNullOrWhiteSpace(lastName) || lastName.Length > 120)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["profile"] = ["First and last names must contain 1 to 120 characters."]
                });
            }

            user.FirstName = firstName;
            user.LastName = lastName;
            var result = await users.UpdateAsync(user);
            return result.Succeeded
                ? Results.Ok(new UserResponse(user.Id, user.Email ?? string.Empty, user.FirstName, user.LastName))
                : Results.ValidationProblem(IdentityErrors(result.Errors));
        });

        account.MapPost("/change-password", async (
            ChangePasswordRequest request,
            ClaimsPrincipal principal,
            UserManager<AppUser> users) =>
        {
            var user = await FindUserAsync(principal, users);
            if (user is null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(request.CurrentPassword) || string.IsNullOrWhiteSpace(request.NewPassword))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["password"] = ["Current and new passwords are required."]
                });
            }
            var result = await users.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
            return result.Succeeded ? Results.NoContent() : Results.ValidationProblem(IdentityErrors(result.Errors));
        });

        account.MapDelete("/account", async (
            [FromBody] DeleteAccountRequest request,
            ClaimsPrincipal principal,
            UserManager<AppUser> users,
            AppDbContext db,
            DatasetCsvImporter importer,
            ExportFileStore exportFileStore,
            CancellationToken cancellationToken) =>
        {
            var user = await FindUserAsync(principal, users);
            if (user is null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(request.Password) || !await users.CheckPasswordAsync(user, request.Password))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["password"] = ["Enter your current password to delete this account."]
                });
            }

            var datasets = await db.Datasets.Where(dataset => dataset.CreatedById == user.Id)
                .ToListAsync(cancellationToken);
            var datasetIds = datasets.Select(dataset => dataset.Id).ToArray();
            var chartIds = await db.SavedCharts.Where(chart => chart.OwnerId == user.Id).Select(chart => chart.Id).ToArrayAsync(cancellationToken);
            var dashboardIds = await db.Dashboards.Where(dashboard => dashboard.OwnerId == user.Id).Select(dashboard => dashboard.Id).ToArrayAsync(cancellationToken);
            if (await db.ImportJobs.AnyAsync(job => job.CreatedById == user.Id &&
                    (job.Status == JobStatus.Queued || job.Status == JobStatus.Running), cancellationToken) ||
                await db.ExportJobs.AnyAsync(job => job.OwnerId == user.Id &&
                    (job.Status == ExportJobStatus.Queued || job.Status == ExportJobStatus.Running), cancellationToken))
            {
                return Results.Conflict(new { detail = "Wait for active import and export jobs to finish before deleting this account." });
            }

            var exports = await db.ExportJobs.Where(job => job.OwnerId == user.Id).ToListAsync(cancellationToken);
            foreach (var export in exports) exportFileStore.Delete(export);
            foreach (var datasetId in datasetIds) await importer.DropTableAsync(datasetId, cancellationToken);

            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            db.DashboardWidgets.RemoveRange(await db.DashboardWidgets
                .Where(widget => dashboardIds.Contains(widget.DashboardId) || chartIds.Contains(widget.SavedChartId))
                .ToListAsync(cancellationToken));
            db.Dashboards.RemoveRange(await db.Dashboards.Where(dashboard => dashboard.OwnerId == user.Id).ToListAsync(cancellationToken));
            db.SavedCharts.RemoveRange(await db.SavedCharts.Where(chart => chart.OwnerId == user.Id).ToListAsync(cancellationToken));
            db.ExportJobs.RemoveRange(await db.ExportJobs.Where(job => job.OwnerId == user.Id).ToListAsync(cancellationToken));
            db.Datasets.RemoveRange(datasets);
            var deletion = await users.DeleteAsync(user);
            if (!deletion.Succeeded)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Results.ValidationProblem(IdentityErrors(deletion.Errors));
            }
            await transaction.CommitAsync(cancellationToken);
            return Results.NoContent();
        });
    }

    private static async Task<AppUser?> FindUserAsync(ClaimsPrincipal principal, UserManager<AppUser> users)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? principal.FindFirstValue("sub");
        return userId is null ? null : await users.FindByIdAsync(userId);
    }

    private static Dictionary<string, string[]> IdentityErrors(IEnumerable<IdentityError> errors) =>
        errors.GroupBy(error => error.Code).ToDictionary(group => group.Key, group => group.Select(error => error.Description).ToArray());
}

public sealed record ProfileUpdateRequest(string? FirstName, string? LastName);
public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);
public sealed record DeleteAccountRequest(string? Password);
