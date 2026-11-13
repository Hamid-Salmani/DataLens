using System.Security.Claims;
using System.Globalization;
using System.Text;
using System.Text.Json;
using DataLens.Api.Analytics;
using DataLens.Api.Auth;
using DataLens.Api.Extensions;
using DataLens.Api.Imports;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using DataLens.Infrastructure.Imports;
using Dapper;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using FluentValidation;

var builder = WebApplication.CreateBuilder(args);
var maximumUploadBytes = builder.Configuration.GetValue<long>("Uploads:MaxFileSizeBytes", 200L * 1024 * 1024);
if (maximumUploadBytes <= 0)
{
    throw new InvalidOperationException("Uploads:MaxFileSizeBytes must be greater than zero.");
}

builder.WebHost.ConfigureKestrel(options =>
    options.Limits.MaxRequestBodySize = maximumUploadBytes + 1024 * 1024);
builder.Services.Configure<FormOptions>(options =>
    options.MultipartBodyLengthLimit = maximumUploadBytes + 1024 * 1024);

builder.Services.AddDataLensServices(builder.Configuration);
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<DatasetAnalyticsService>();
builder.Services.AddValidatorsFromAssemblyContaining<SavedChartRequestValidator>();
builder.Services.AddSignalR();
builder.Services.AddSingleton<ImportJobQueue>();
builder.Services.AddSingleton<ImportJobCancellation>();
builder.Services.AddSingleton<ImportFileStore>();
builder.Services.AddSingleton<IImportJobNotifier, SignalRImportJobNotifier>();
builder.Services.AddHostedService<ImportJobProcessingService>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddProblemDetails();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
}

app.UseExceptionHandler();
app.UseRouting();
app.UseCors("frontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseHttpsRedirection();
}

app.MapHealthChecks("/health");
app.MapHub<ImportJobHub>("/hubs/jobs").RequireAuthorization();
app.MapSavedChartEndpoints();
app.MapDashboardEndpoints();

var auth = app.MapGroup("/api/auth");
auth.MapPost("/register", async (
    RegisterRequest request,
    UserManager<AppUser> users,
    AccessTokenService tokens) =>
{
    if (string.IsNullOrWhiteSpace(request.Email) ||
        string.IsNullOrWhiteSpace(request.FirstName) ||
        string.IsNullOrWhiteSpace(request.LastName) ||
        string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["profile"] = ["Email, first name, and last name are required."]
        });
    }

    var user = new AppUser
    {
        UserName = request.Email.Trim(),
        Email = request.Email.Trim(),
        FirstName = request.FirstName.Trim(),
        LastName = request.LastName.Trim()
    };
    var result = await users.CreateAsync(user, request.Password);
    if (!result.Succeeded)
    {
        return Results.ValidationProblem(result.Errors
            .GroupBy(error => error.Code)
            .ToDictionary(group => group.Key, group => group.Select(error => error.Description).ToArray()));
    }

    return Results.Ok(CreateAuthResponse(user, tokens));
}).RequireRateLimiting("auth");

auth.MapPost("/login", async (
    LoginRequest request,
    UserManager<AppUser> users,
    AccessTokenService tokens) =>
{
    var user = await users.FindByEmailAsync(request.Email);
    if (user is null ||
        await users.IsLockedOutAsync(user) ||
        !await users.CheckPasswordAsync(user, request.Password))
    {
        if (user is not null && !await users.IsLockedOutAsync(user))
        {
            await users.AccessFailedAsync(user);
        }

        return Results.Problem(
            title: "Invalid credentials",
            detail: "The email or password is incorrect.",
            statusCode: StatusCodes.Status401Unauthorized);
    }

    await users.ResetAccessFailedCountAsync(user);
    return Results.Ok(CreateAuthResponse(user, tokens));
}).RequireRateLimiting("auth");

auth.MapGet("/me", async (ClaimsPrincipal principal, UserManager<AppUser> users) =>
{
    var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? principal.FindFirstValue("sub");
    var user = userId is null ? null : await users.FindByIdAsync(userId);
    return user is null
        ? Results.NotFound()
        : Results.Ok(new UserResponse(user.Id, user.Email ?? string.Empty, user.FirstName, user.LastName));
}).RequireAuthorization();

var datasets = app.MapGroup("/api/datasets").RequireAuthorization();

datasets.MapGet("/", async (ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var items = await db.Datasets.AsNoTracking()
        .Where(dataset => dataset.CreatedById == userId)
        .OrderByDescending(dataset => dataset.CreatedAt)
        .Select(dataset => new DatasetListItem(
            dataset.Id,
            dataset.Name,
            dataset.FileName,
            dataset.RowCount,
            dataset.SkippedRows,
            dataset.CreatedAt,
            dataset.Columns.Count))
        .ToListAsync(cancellationToken);

    return Results.Ok(items);
});

datasets.MapPost("/", async (
    HttpRequest request,
    ClaimsPrincipal principal,
    AppDbContext db,
    ImportJobQueue queue,
    ImportFileStore fileStore,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
    {
        return Results.Problem(
            title: "CSV file required",
            detail: "Send a multipart/form-data request with a file field named 'file'.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0)
    {
        return Results.Problem(
            title: "CSV file required",
            detail: "Choose a non-empty CSV file to import.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (!string.Equals(Path.GetExtension(file.FileName), ".csv", StringComparison.OrdinalIgnoreCase) ||
        !(file.ContentType.StartsWith("text/", StringComparison.OrdinalIgnoreCase) ||
          file.ContentType.Equals("application/vnd.ms-excel", StringComparison.OrdinalIgnoreCase) ||
          file.ContentType.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase)))
    {
        return Results.Problem(
            title: "Unsupported file",
            detail: "Only CSV files are accepted.",
            statusCode: StatusCodes.Status415UnsupportedMediaType);
    }

    if (file.Length > maximumUploadBytes)
    {
        return Results.Problem(
            title: "File too large",
            detail: $"CSV uploads are limited to {maximumUploadBytes / (1024 * 1024)} MB.",
            statusCode: StatusCodes.Status413PayloadTooLarge);
    }

    var name = form["name"].ToString().Trim();
    if (name.Length == 0)
    {
        name = Path.GetFileNameWithoutExtension(file.FileName);
    }

    if (name.Length > 200)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["name"] = ["Dataset name cannot exceed 200 characters."]
        });
    }

    var userId = GetUserId(principal);
    var dataset = new Dataset
    {
        Name = name,
        FileName = Path.GetFileName(file.FileName),
        CreatedById = userId
    };
    var job = new ImportJob
    {
        DatasetId = dataset.Id,
        CreatedById = userId,
        FileSizeBytes = file.Length
    };

    try
    {
        await using var stream = file.OpenReadStream();
        await fileStore.StoreAsync(job.Id, stream, cancellationToken);
        db.Datasets.Add(dataset);
        db.ImportJobs.Add(job);
        await db.SaveChangesAsync(cancellationToken);

        if (!queue.TryEnqueue(job.Id))
        {
            db.ImportJobs.Remove(job);
            db.Datasets.Remove(dataset);
            await db.SaveChangesAsync(cancellationToken);
            fileStore.Delete(job.Id);
            return Results.Problem(
                title: "Import queue is full",
                detail: "Please wait for another import to finish, then try again.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Accepted(
            $"/api/import-jobs/{job.Id}",
            new { jobId = job.Id, datasetId = dataset.Id });
    }
    catch
    {
        fileStore.Delete(job.Id);
        throw;
    }
}).RequireRateLimiting("upload");

datasets.MapGet("/{id:guid}", async (
    Guid id,
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets.AsNoTracking()
        .Include(item => item.Columns)
        .SingleOrDefaultAsync(
            item => item.Id == id && item.CreatedById == userId,
            cancellationToken);

    return dataset is null ? Results.NotFound() : Results.Ok(ToDatasetResponse(dataset));
});

datasets.MapPut("/{id:guid}/columns/{position:int}", async (
    Guid id,
    int position,
    RenameDatasetColumnRequest request,
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets
        .Include(item => item.Columns)
        .SingleOrDefaultAsync(
            item => item.Id == id && item.CreatedById == userId,
            cancellationToken);
    if (dataset is null)
    {
        return Results.NotFound();
    }

    if (await db.ImportJobs.AnyAsync(
        job => job.DatasetId == id && (job.Status == JobStatus.Queued || job.Status == JobStatus.Running),
        cancellationToken))
    {
        return Results.Conflict(new { detail = "Wait for the import to finish before renaming columns." });
    }

    var column = dataset.Columns.SingleOrDefault(item => item.Position == position);
    if (column is null)
    {
        return Results.NotFound();
    }

    var name = request.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name) || name.Length > 200)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["name"] = ["Column names must contain 1 to 200 characters."]
        });
    }

    if (dataset.Columns.Any(item =>
        item.Id != column.Id && string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase)))
    {
        return Results.Conflict(new { detail = "Column names must be unique within a dataset." });
    }

    column.Name = name;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new DatasetColumnResponse(column.Position, column.Name, column.TypeName, column.IsNullable));
});

datasets.MapGet("/{id:guid}/preview", async (
    Guid id,
    int? page,
    int? pageSize,
    string? sortBy,
    string? sortDirection,
    ClaimsPrincipal principal,
    AppDbContext db,
    IConfiguration configuration,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets.AsNoTracking()
        .Include(item => item.Columns)
        .SingleOrDefaultAsync(
            item => item.Id == id && item.CreatedById == userId,
            cancellationToken);

    if (dataset is null)
    {
        return Results.NotFound();
    }

    if (await db.ImportJobs.AnyAsync(
        job => job.DatasetId == id && (job.Status == JobStatus.Queued || job.Status == JobStatus.Running),
        cancellationToken))
    {
        return Results.Conflict(new { detail = "Wait for the import to finish before previewing this dataset." });
    }

    var currentPage = Math.Max(page ?? 1, 1);
    var size = Math.Clamp(pageSize ?? 50, 1, 100);
    var columns = dataset.Columns.OrderBy(column => column.Position).ToArray();
    if (columns.Length == 0)
    {
        return Results.Conflict(new { detail = "This dataset does not have an imported schema yet." });
    }

    var sortColumn = string.IsNullOrWhiteSpace(sortBy)
        ? null
        : columns.SingleOrDefault(column => string.Equals(column.Name, sortBy, StringComparison.Ordinal));
    if (!string.IsNullOrWhiteSpace(sortBy) && sortColumn is null)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["sortBy"] = ["Choose a column from this dataset."]
        });
    }

    var direction = string.IsNullOrWhiteSpace(sortDirection) ? "ASC" : sortDirection.ToUpperInvariant();
    if (direction is not ("ASC" or "DESC"))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["sortDirection"] = ["Sort direction must be 'asc' or 'desc'."]
        });
    }

    var selectedColumns = string.Join(", ", columns.Select(column =>
        $"[c{column.Position}] AS [c{column.Position}]"));
    var orderBy = sortColumn is null
        ? "(SELECT 1)"
        : $"[c{sortColumn.Position}] {direction}";
    await using var connection = new SqlConnection(configuration.GetConnectionString("DefaultConnection"));
    var sql = $"""
        SELECT {selectedColumns}
        FROM {DatasetCsvImporter.GetTableName(dataset.Id)}
        ORDER BY {orderBy}
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        """;
    var rows = await connection.QueryAsync(
        new CommandDefinition(sql, new { Offset = (currentPage - 1) * size, PageSize = size }, cancellationToken: cancellationToken));

    var items = rows.Select(row =>
    {
        var values = (IDictionary<string, object>)row;
        return columns.ToDictionary(
            column => column.Name,
            column => values.TryGetValue($"c{column.Position}", out var value) && value is not DBNull ? value : null);
    }).ToArray();

    return Results.Ok(new DatasetPreview(dataset.Id, dataset.RowCount, currentPage, size, items));
});

datasets.MapPost("/{id:guid}/analytics", async (
    Guid id,
    DatasetAnalyticsRequest request,
    ClaimsPrincipal principal,
    AppDbContext db,
    DatasetAnalyticsService analytics,
    HttpResponse response,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets.AsNoTracking()
        .Include(item => item.Columns)
        .SingleOrDefaultAsync(
            item => item.Id == id && item.CreatedById == userId,
            cancellationToken);
    if (dataset is null)
    {
        return Results.NotFound();
    }

    if (await db.ImportJobs.AnyAsync(
        job => job.DatasetId == id && (job.Status == JobStatus.Queued || job.Status == JobStatus.Running),
        cancellationToken))
    {
        return Results.Conflict(new { detail = "Wait for the import to finish before running analytics." });
    }

    try
    {
        var result = await analytics.ExecuteAsync(dataset, request, cancellationToken);
        response.Headers.CacheControl = "private, max-age=30";
        return Results.Ok(result);
    }
    catch (InvalidDataException exception)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["query"] = [exception.Message]
        });
    }
});

datasets.MapGet("/{id:guid}/reports", async (
    Guid id,
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var ownsDataset = await db.Datasets.AsNoTracking()
        .AnyAsync(dataset => dataset.Id == id && dataset.CreatedById == userId, cancellationToken);
    if (!ownsDataset)
    {
        return Results.NotFound();
    }

    var reports = await db.SavedReports.AsNoTracking()
        .Where(report => report.DatasetId == id)
        .OrderByDescending(report => report.UpdatedAt)
        .Select(report => new { report.Id, report.DatasetId, report.Name, report.ChartType, report.QueryJson, report.CreatedAt, report.UpdatedAt })
        .ToListAsync(cancellationToken);
    return Results.Ok(reports.Select(report => ToSavedReportResponse(
        report.Id,
        report.DatasetId,
        report.Name,
        report.ChartType,
        report.QueryJson,
        report.CreatedAt,
        report.UpdatedAt)).ToArray());
});

datasets.MapPost("/{id:guid}/reports", async (
    Guid id,
    SavedReportRequest request,
    ClaimsPrincipal principal,
    AppDbContext db,
    DatasetAnalyticsService analytics,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets
        .Include(item => item.Columns)
        .SingleOrDefaultAsync(item => item.Id == id && item.CreatedById == userId, cancellationToken);
    if (dataset is null)
    {
        return Results.NotFound();
    }

    var validationError = ValidateSavedReport(request, dataset, analytics);
    if (validationError is not null)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["report"] = [validationError]
        });
    }

    var report = new SavedReport
    {
        DatasetId = dataset.Id,
        Name = request.Name!.Trim(),
        ChartType = request.ChartType!.ToLowerInvariant(),
        QueryJson = JsonSerializer.Serialize(request.Query)
    };
    db.SavedReports.Add(report);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created(
        $"/api/datasets/{dataset.Id}/reports/{report.Id}",
        ToSavedReportResponse(report.Id, report.DatasetId, report.Name, report.ChartType, report.QueryJson, report.CreatedAt, report.UpdatedAt));
});

datasets.MapPut("/{id:guid}/reports/{reportId:guid}", async (
    Guid id,
    Guid reportId,
    SavedReportRequest request,
    ClaimsPrincipal principal,
    AppDbContext db,
    DatasetAnalyticsService analytics,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets
        .Include(item => item.Columns)
        .SingleOrDefaultAsync(item => item.Id == id && item.CreatedById == userId, cancellationToken);
    if (dataset is null)
    {
        return Results.NotFound();
    }

    var report = await db.SavedReports.SingleOrDefaultAsync(
        item => item.Id == reportId && item.DatasetId == id,
        cancellationToken);
    if (report is null)
    {
        return Results.NotFound();
    }

    var validationError = ValidateSavedReport(request, dataset, analytics);
    if (validationError is not null)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["report"] = [validationError]
        });
    }

    report.Name = request.Name!.Trim();
    report.ChartType = request.ChartType!.ToLowerInvariant();
    report.QueryJson = JsonSerializer.Serialize(request.Query);
    report.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(ToSavedReportResponse(
        report.Id,
        report.DatasetId,
        report.Name,
        report.ChartType,
        report.QueryJson,
        report.CreatedAt,
        report.UpdatedAt));
});

datasets.MapDelete("/{id:guid}/reports/{reportId:guid}", async (
    Guid id,
    Guid reportId,
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var report = await db.SavedReports.SingleOrDefaultAsync(
        item => item.Id == reportId && item.DatasetId == id && item.Dataset!.CreatedById == userId,
        cancellationToken);
    if (report is null)
    {
        return Results.NotFound();
    }

    db.SavedReports.Remove(report);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

datasets.MapPost("/{id:guid}/reports/{reportId:guid}/run", async (
    Guid id,
    Guid reportId,
    ClaimsPrincipal principal,
    AppDbContext db,
    DatasetAnalyticsService analytics,
    HttpResponse response,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets.AsNoTracking()
        .Include(item => item.Columns)
        .SingleOrDefaultAsync(item => item.Id == id && item.CreatedById == userId, cancellationToken);
    if (dataset is null)
    {
        return Results.NotFound();
    }

    var report = await db.SavedReports.AsNoTracking()
        .SingleOrDefaultAsync(item => item.Id == reportId && item.DatasetId == id, cancellationToken);
    if (report is null)
    {
        return Results.NotFound();
    }

    if (await db.ImportJobs.AnyAsync(
        job => job.DatasetId == id && (job.Status == JobStatus.Queued || job.Status == JobStatus.Running),
        cancellationToken))
    {
        return Results.Conflict(new { detail = "Wait for the import to finish before running this report." });
    }

    var query = JsonSerializer.Deserialize<DatasetAnalyticsRequest>(report.QueryJson)
        ?? throw new InvalidDataException("This saved report has an invalid query.");
    try
    {
        var result = await analytics.ExecuteAsync(dataset, query, cancellationToken);
        response.Headers.CacheControl = "private, max-age=30";
        return Results.Ok(result);
    }
    catch (InvalidDataException exception)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["query"] = [exception.Message]
        });
    }
});

datasets.MapGet("/{id:guid}/import-errors", async (
    Guid id,
    int? page,
    int? pageSize,
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets.AsNoTracking()
        .Where(item => item.Id == id && item.CreatedById == userId)
        .Select(item => new { item.Id, item.SkippedRows })
        .SingleOrDefaultAsync(cancellationToken);
    if (dataset is null)
    {
        return Results.NotFound();
    }

    var currentPage = Math.Max(page ?? 1, 1);
    var size = Math.Clamp(pageSize ?? 25, 1, 100);
    var errors = await db.ImportErrors.AsNoTracking()
        .Where(error => error.DatasetId == id)
        .OrderBy(error => error.RowNumber)
        .ThenBy(error => error.Id)
        .Skip((currentPage - 1) * size)
        .Take(size)
        .Select(error => new ImportErrorItem(
            error.RowNumber,
            error.ColumnName,
            error.RawValue,
            error.Reason))
        .ToArrayAsync(cancellationToken);
    var totalErrors = await db.ImportErrors.CountAsync(error => error.DatasetId == id, cancellationToken);
    return Results.Ok(new ImportErrorPage(currentPage, size, dataset.SkippedRows, totalErrors, errors));
});

datasets.MapGet("/{id:guid}/import-errors.csv", async (
    Guid id,
    ClaimsPrincipal principal,
    AppDbContext db,
    HttpResponse response,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var ownsDataset = await db.Datasets.AsNoTracking()
        .AnyAsync(dataset => dataset.Id == id && dataset.CreatedById == userId, cancellationToken);
    if (!ownsDataset)
    {
        return Results.NotFound();
    }

    response.ContentType = "text/csv; charset=utf-8";
    response.Headers.ContentDisposition = $"attachment; filename=\"import-errors-{id:N}.csv\"";
    await using (var writer = new StreamWriter(response.Body, new UTF8Encoding(false), leaveOpen: true))
    {
        await writer.WriteLineAsync("rowNumber,columnName,rawValue,reason".AsMemory(), cancellationToken);
        var offset = 0;
        while (true)
        {
            var errors = await db.ImportErrors.AsNoTracking()
                .Where(error => error.DatasetId == id)
                .OrderBy(error => error.RowNumber)
                .ThenBy(error => error.Id)
                .Skip(offset)
                .Take(1_000)
                .ToListAsync(cancellationToken);
            if (errors.Count == 0)
            {
                break;
            }

            foreach (var error in errors)
            {
                var line = string.Join(",",
                [
                    error.RowNumber.ToString(CultureInfo.InvariantCulture),
                    EscapeCsv(error.ColumnName),
                    EscapeCsv(error.RawValue),
                    EscapeCsv(error.Reason)
                ]);
                await writer.WriteLineAsync(line.AsMemory(), cancellationToken);
            }

            offset += errors.Count;
        }

        await writer.FlushAsync(cancellationToken);
    }

    return Results.Empty;
});

datasets.MapDelete("/{id:guid}", async (
    Guid id,
    ClaimsPrincipal principal,
    AppDbContext db,
    DatasetCsvImporter importer,
    ImportFileStore fileStore,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var dataset = await db.Datasets.SingleOrDefaultAsync(
        item => item.Id == id && item.CreatedById == userId,
        cancellationToken);
    if (dataset is null)
    {
        return Results.NotFound();
    }

    var jobs = await db.ImportJobs
        .Where(job => job.DatasetId == id)
        .ToListAsync(cancellationToken);
    if (jobs.Any(job => job.Status is JobStatus.Queued or JobStatus.Running))
    {
        return Results.Conflict(new { detail = "Cancel active imports before deleting this dataset." });
    }

    await importer.DropTableAsync(id, cancellationToken);
    var chartIds = await db.SavedCharts.Where(chart => chart.DatasetId == id)
        .Select(chart => chart.Id).ToArrayAsync(cancellationToken);
    var widgets = await db.DashboardWidgets.Where(widget => chartIds.Contains(widget.SavedChartId))
        .ToListAsync(cancellationToken);
    db.DashboardWidgets.RemoveRange(widgets);
    db.Datasets.Remove(dataset);
    await db.SaveChangesAsync(cancellationToken);
    foreach (var job in jobs)
    {
        fileStore.Delete(job.Id);
    }

    return Results.NoContent();
});

var importJobs = app.MapGroup("/api/import-jobs").RequireAuthorization();

importJobs.MapGet("/", async (
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var jobs = await db.ImportJobs.AsNoTracking()
        .Include(job => job.Dataset)
        .Where(job => job.CreatedById == userId)
        .OrderByDescending(job => job.CreatedAt)
        .Take(100)
        .ToListAsync(cancellationToken);
    return Results.Ok(jobs.Select(ImportJobProcessingService.ToStatus).ToArray());
});

importJobs.MapGet("/{id:guid}", async (
    Guid id,
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var job = await db.ImportJobs.AsNoTracking()
        .Include(item => item.Dataset)
        .SingleOrDefaultAsync(item => item.Id == id && item.CreatedById == userId, cancellationToken);
    return job is null ? Results.NotFound() : Results.Ok(ImportJobProcessingService.ToStatus(job));
});

importJobs.MapPost("/{id:guid}/cancel", async (
    Guid id,
    ClaimsPrincipal principal,
    AppDbContext db,
    ImportJobCancellation cancellation,
    IImportJobNotifier notifier,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var job = await db.ImportJobs
        .Include(item => item.Dataset)
        .SingleOrDefaultAsync(item => item.Id == id && item.CreatedById == userId, cancellationToken);
    if (job is null)
    {
        return Results.NotFound();
    }

    if (job.Status == JobStatus.Queued)
    {
        job.Status = JobStatus.Cancelled;
        job.ErrorMessage = "The import was cancelled.";
        job.CompletedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await notifier.CancelledAsync(ImportJobProcessingService.ToStatus(job), cancellationToken);
        return Results.Ok(ImportJobProcessingService.ToStatus(job));
    }

    if (job.Status != JobStatus.Running || !cancellation.Cancel(job.Id))
    {
        return Results.Conflict(new { detail = "Only queued or running imports can be cancelled." });
    }

    return Results.Accepted($"/api/import-jobs/{job.Id}", ImportJobProcessingService.ToStatus(job));
});

importJobs.MapPost("/{id:guid}/retry", async (
    Guid id,
    ClaimsPrincipal principal,
    AppDbContext db,
    ImportJobQueue queue,
    ImportFileStore fileStore,
    DatasetCsvImporter importer,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var job = await db.ImportJobs
        .Include(item => item.Dataset)
        .ThenInclude(dataset => dataset!.Columns)
        .SingleOrDefaultAsync(item => item.Id == id && item.CreatedById == userId, cancellationToken);
    if (job is null)
    {
        return Results.NotFound();
    }

    if (job.Status is not (JobStatus.Failed or JobStatus.Cancelled))
    {
        return Results.Conflict(new { detail = "Only failed or cancelled imports can be retried." });
    }

    if (job.Dataset is null || !File.Exists(fileStore.GetPath(job.Id)))
    {
        return Results.Conflict(new { detail = "The original CSV is no longer available for retry." });
    }

    await importer.DropTableAsync(job.DatasetId, cancellationToken);
    await db.ImportErrors.Where(error => error.DatasetId == job.DatasetId).ExecuteDeleteAsync(cancellationToken);
    db.DatasetColumns.RemoveRange(job.Dataset.Columns);
    job.Dataset.RowCount = 0;
    job.Dataset.SkippedRows = 0;
    job.Status = JobStatus.Queued;
    job.Progress = 0;
    job.RowsProcessed = 0;
    job.RowsSkipped = 0;
    job.ErrorMessage = null;
    job.StartedAt = null;
    job.CompletedAt = null;
    await db.SaveChangesAsync(cancellationToken);

    if (!queue.TryEnqueue(job.Id))
    {
        job.Status = JobStatus.Failed;
        job.ErrorMessage = "The import queue is full. Retry again in a moment.";
        job.CompletedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Problem(
            title: "Import queue is full",
            detail: job.ErrorMessage,
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    return Results.Accepted($"/api/import-jobs/{job.Id}", ImportJobProcessingService.ToStatus(job));
});

app.MapGet("/api/dashboard/summary", async (
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = GetUserId(principal);
    var datasetsForUser = db.Datasets.AsNoTracking().Where(dataset => dataset.CreatedById == userId);
    var datasetCount = await datasetsForUser.CountAsync(cancellationToken);
    var totalRows = await datasetsForUser.SumAsync(dataset => (long?)dataset.RowCount, cancellationToken) ?? 0;
    var latestDataset = await datasetsForUser
        .OrderByDescending(dataset => dataset.CreatedAt)
        .Select(dataset => new { dataset.Id, dataset.Name, dataset.CreatedAt, dataset.RowCount })
        .FirstOrDefaultAsync(cancellationToken);

    return Results.Ok(new DashboardSummary(datasetCount, totalRows, latestDataset));
}).RequireAuthorization();

app.Run();

static string GetUserId(ClaimsPrincipal principal) =>
    principal.FindFirstValue(ClaimTypes.NameIdentifier)
    ?? principal.FindFirstValue("sub")
    ?? throw new UnauthorizedAccessException("The access token has no user identifier.");

static AuthResponse CreateAuthResponse(AppUser user, AccessTokenService tokens) =>
    new(tokens.Create(user), new UserResponse(user.Id, user.Email ?? string.Empty, user.FirstName, user.LastName));

static DatasetResponse ToDatasetResponse(Dataset dataset) =>
    new(
        dataset.Id,
        dataset.Name,
        dataset.FileName,
        dataset.RowCount,
        dataset.SkippedRows,
        dataset.CreatedAt,
        dataset.Columns.OrderBy(column => column.Position)
            .Select(column => new DatasetColumnResponse(column.Position, column.Name, column.TypeName, column.IsNullable))
            .ToArray());

static string EscapeCsv(string? value) => $"\"{(value ?? string.Empty).Replace("\"", "\"\"")}\"";

static string? ValidateSavedReport(
    SavedReportRequest request,
    Dataset dataset,
    DatasetAnalyticsService analytics)
{
    var name = request.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name) || name.Length > 200)
    {
        return "Report names must contain 1 to 200 characters.";
    }

    var chartType = request.ChartType?.ToLowerInvariant();
    if (chartType is not ("bar" or "line" or "pie" or "table"))
    {
        return "Choose bar, line, pie, or table as the chart type.";
    }

    if (request.Query is null)
    {
        return "A valid analytics query is required.";
    }

    try
    {
        analytics.Validate(dataset, request.Query);
    }
    catch (InvalidDataException exception)
    {
        return exception.Message;
    }

    return null;
}

static SavedReportResponse ToSavedReportResponse(
    Guid id,
    Guid datasetId,
    string name,
    string chartType,
    string queryJson,
    DateTime createdAt,
    DateTime updatedAt)
{
    var query = JsonSerializer.Deserialize<DatasetAnalyticsRequest>(queryJson)
        ?? throw new InvalidDataException("This saved report has an invalid query.");
    return new SavedReportResponse(id, datasetId, name, chartType, query, createdAt, updatedAt);
}

public partial class Program;

public sealed record RegisterRequest(string Email, string Password, string FirstName, string LastName);
public sealed record LoginRequest(string Email, string Password);
public sealed record UserResponse(string Id, string Email, string FirstName, string LastName);
public sealed record AuthResponse(string AccessToken, UserResponse User);
public sealed record DatasetListItem(Guid Id, string Name, string FileName, long RowCount, long SkippedRows, DateTime CreatedAt, int ColumnCount);
public sealed record ImportErrorItem(long RowNumber, string? ColumnName, string? RawValue, string Reason);
public sealed record ImportErrorPage(int Page, int PageSize, long RowsSkipped, long TotalErrors, ImportErrorItem[] Errors);
public sealed record RenameDatasetColumnRequest(string? Name);
public sealed record DatasetColumnResponse(int Position, string Name, string TypeName, bool IsNullable);
public sealed record DatasetResponse(Guid Id, string Name, string FileName, long RowCount, long SkippedRows, DateTime CreatedAt, DatasetColumnResponse[] Columns);
public sealed record DatasetPreview(Guid DatasetId, long TotalRows, int Page, int PageSize, Dictionary<string, object?>[] Rows);
public sealed record DashboardSummary(int DatasetCount, long TotalRows, object? LatestDataset);
