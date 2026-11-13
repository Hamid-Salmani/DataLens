using System.Security.Claims;
using DataLens.Api.Extensions;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Api.Analytics;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app)
    {
        var dashboards = app.MapGroup("/api/dashboards").RequireAuthorization();

        dashboards.MapGet("/", async (ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var items = await db.Dashboards.AsNoTracking().Include(item => item.Widgets)
                .ThenInclude(widget => widget.SavedChart).ThenInclude(chart => chart!.Dataset)
                .Where(item => item.OwnerId == userId).OrderByDescending(item => item.IsDefault).ThenBy(item => item.CreatedAt)
                .ToListAsync(cancellationToken);
            return Results.Ok(items.Select(ToResponse));
        });

        dashboards.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var dashboard = await LoadDashboard(db, id, userId, cancellationToken);
            return dashboard is null ? Results.NotFound() : Results.Ok(ToResponse(dashboard));
        });

        dashboards.MapPost("/", async (
            DashboardRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            IValidator<DashboardRequest> validator,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid) return Results.ValidationProblem(validation.ToDictionary());
            var isFirst = !await db.Dashboards.AnyAsync(item => item.OwnerId == userId, cancellationToken);
            var dashboard = new Dashboard { OwnerId = userId, Name = request.Name!.Trim(), IsDefault = isFirst };
            db.Dashboards.Add(dashboard);
            await db.SaveChangesAsync(cancellationToken);
            return Results.Created($"/api/dashboards/{dashboard.Id}", ToResponse(dashboard));
        });

        dashboards.MapPut("/{id:guid}", async (
            Guid id,
            DashboardRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            IValidator<DashboardRequest> validator,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var dashboard = await db.Dashboards.Include(item => item.Widgets)
                .ThenInclude(widget => widget.SavedChart).ThenInclude(chart => chart!.Dataset)
                .SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);
            if (dashboard is null) return Results.NotFound();
            var validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid) return Results.ValidationProblem(validation.ToDictionary());
            dashboard.Name = request.Name!.Trim();
            dashboard.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return Results.Ok(ToResponse(dashboard));
        });

        dashboards.MapPost("/{id:guid}/default", async (Guid id, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var dashboardsForUser = await db.Dashboards.Where(item => item.OwnerId == userId).ToListAsync(cancellationToken);
            var selected = dashboardsForUser.SingleOrDefault(item => item.Id == id);
            if (selected is null) return Results.NotFound();
            foreach (var item in dashboardsForUser)
            {
                item.IsDefault = item.Id == id;
                item.UpdatedAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        });

        dashboards.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var dashboard = await db.Dashboards.SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);
            if (dashboard is null) return Results.NotFound();
            var wasDefault = dashboard.IsDefault;
            var linkedExports = await db.ExportJobs.Where(item => item.DashboardId == id).ToListAsync(cancellationToken);
            foreach (var export in linkedExports) export.DashboardId = null;
            db.Dashboards.Remove(dashboard);
            await db.SaveChangesAsync(cancellationToken);
            if (wasDefault)
            {
                var next = await db.Dashboards.Where(item => item.OwnerId == userId).OrderBy(item => item.CreatedAt).FirstOrDefaultAsync(cancellationToken);
                if (next is not null)
                {
                    next.IsDefault = true;
                    next.UpdatedAt = DateTime.UtcNow;
                    await db.SaveChangesAsync(cancellationToken);
                }
            }
            return Results.NoContent();
        });

        dashboards.MapPost("/{id:guid}/widgets", async (
            Guid id,
            DashboardWidgetRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var dashboard = await db.Dashboards.SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);
            if (dashboard is null) return Results.NotFound();
            if (!ValidBounds(request.X, request.Y, request.Width, request.Height))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["layout"] = ["Widget position and size are outside the 12-column dashboard grid."] });
            var chart = await db.SavedCharts.SingleOrDefaultAsync(item => item.Id == request.SavedChartId && item.OwnerId == userId, cancellationToken);
            if (chart is null) return Results.NotFound();
            if (await db.DashboardWidgets.AnyAsync(item => item.DashboardId == id && item.SavedChartId == chart.Id, cancellationToken))
                return Results.Conflict(new { detail = "This chart is already on the dashboard." });

            var widget = new DashboardWidget
            {
                DashboardId = id,
                SavedChartId = chart.Id,
                X = request.X,
                Y = request.Y,
                Width = request.Width,
                Height = request.Height,
                TitleOverride = request.TitleOverride?.Trim()
            };
            db.DashboardWidgets.Add(widget);
            dashboard.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return Results.Created($"/api/dashboards/{id}/widgets/{widget.Id}", new { widget.Id });
        });

        dashboards.MapDelete("/{id:guid}/widgets/{widgetId:guid}", async (
            Guid id,
            Guid widgetId,
            ClaimsPrincipal principal,
            AppDbContext db,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var widget = await db.DashboardWidgets.Include(item => item.Dashboard)
                .SingleOrDefaultAsync(item => item.Id == widgetId && item.DashboardId == id && item.Dashboard!.OwnerId == userId, cancellationToken);
            if (widget is null) return Results.NotFound();
            widget.Dashboard!.UpdatedAt = DateTime.UtcNow;
            db.DashboardWidgets.Remove(widget);
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        });

        dashboards.MapPut("/{id:guid}/layout", async (
            Guid id,
            DashboardLayoutRequest request,
            ClaimsPrincipal principal,
            AppDbContext db,
            CancellationToken cancellationToken) =>
        {
            var userId = ApiUserIdentity.GetUserId(principal);
            var dashboard = await LoadDashboard(db, id, userId, cancellationToken);
            if (dashboard is null) return Results.NotFound();
            byte[] expectedVersion;
            try { expectedVersion = Convert.FromBase64String(request.Version); }
            catch (FormatException) { return Results.ValidationProblem(new Dictionary<string, string[]> { ["version"] = ["A valid dashboard version is required."] }); }
            if (!expectedVersion.SequenceEqual(dashboard.RowVersion))
                return Results.Conflict(new { detail = "The dashboard changed in another session. Reload the latest layout." });

            var widgets = request.Widgets ?? [];
            if (widgets.Length > 100 || widgets.Select(item => item.SavedChartId).Distinct().Count() != widgets.Length ||
                widgets.Any(item => !ValidBounds(item.X, item.Y, item.Width, item.Height)))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["widgets"] = ["Layout must contain up to 100 unique charts within the 12-column grid."] });
            var chartIds = widgets.Select(item => item.SavedChartId).ToArray();
            var ownedIds = await db.SavedCharts.Where(item => item.OwnerId == userId && chartIds.Contains(item.Id))
                .Select(item => item.Id).ToArrayAsync(cancellationToken);
            if (ownedIds.Length != chartIds.Length)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["widgets"] = ["Every widget must reference one of your saved charts."] });

            var requestedIds = chartIds.ToHashSet();
            db.DashboardWidgets.RemoveRange(dashboard.Widgets.Where(item => !requestedIds.Contains(item.SavedChartId)));
            foreach (var item in widgets)
            {
                var widget = dashboard.Widgets.SingleOrDefault(current => current.SavedChartId == item.SavedChartId);
                if (widget is null)
                {
                    widget = new DashboardWidget { DashboardId = id, SavedChartId = item.SavedChartId };
                    db.DashboardWidgets.Add(widget);
                }
                widget.X = item.X;
                widget.Y = item.Y;
                widget.Width = item.Width;
                widget.Height = item.Height;
                widget.TitleOverride = item.TitleOverride?.Trim();
            }

            dashboard.UpdatedAt = DateTime.UtcNow;
            db.Entry(dashboard).Property(item => item.RowVersion).OriginalValue = expectedVersion;
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Results.Conflict(new { detail = "The dashboard changed in another session. Reload the latest layout." });
            }
            var updated = await LoadDashboard(db, id, userId, cancellationToken);
            return Results.Ok(ToResponse(updated!));
        });
    }

    private static Task<Dashboard?> LoadDashboard(AppDbContext db, Guid id, string userId, CancellationToken cancellationToken) =>
        db.Dashboards.Include(item => item.Widgets)
            .ThenInclude(widget => widget.SavedChart).ThenInclude(chart => chart!.Dataset)
            .SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == userId, cancellationToken);

    private static bool ValidBounds(int x, int y, int width, int height) =>
        x >= 0 && x < 12 && y >= 0 && width is >= 1 and <= 12 && height is >= 1 and <= 12 && x + width <= 12;

    private static DashboardResponse ToResponse(Dashboard dashboard) =>
        new(
            dashboard.Id,
            dashboard.Name,
            dashboard.IsDefault,
            dashboard.Widgets.OrderBy(widget => widget.Y).ThenBy(widget => widget.X)
                .Where(widget => widget.SavedChart is not null)
                .Select(widget => new DashboardWidgetResponse(
                    widget.Id,
                    widget.SavedChartId,
                    widget.X,
                    widget.Y,
                    widget.Width,
                    widget.Height,
                    widget.TitleOverride,
                    SavedChartEndpoints.ToResponse(widget.SavedChart!)))
                .ToArray(),
            Convert.ToBase64String(dashboard.RowVersion));
}
