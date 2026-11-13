using System.Globalization;
using System.Diagnostics;
using System.Text.Json;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Imports;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace DataLens.Api.Analytics;

public sealed class DatasetAnalyticsService(
    IConfiguration configuration,
    IMemoryCache cache)
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);
    private static readonly HashSet<string> AggregateFunctions = new(StringComparer.OrdinalIgnoreCase)
    {
        "count", "sum", "avg", "min", "max"
    };

    public void Validate(Dataset dataset, DatasetAnalyticsRequest request)
    {
        _ = BuildPlan(dataset, request);
    }

    public async Task<DatasetAnalyticsResult> ExecuteAsync(
        Dataset dataset,
        DatasetAnalyticsRequest request,
        CancellationToken cancellationToken)
        => (await ExecuteWithDiagnosticsAsync(dataset, request, cancellationToken)).Result;

    public async Task<AnalyticsExecutionResult> ExecuteForChartAsync(
        Dataset dataset,
        DatasetAnalyticsRequest request,
        AnalyticsDateRange? dateRange,
        bool includeComparison,
        CancellationToken cancellationToken)
    {
        var dateColumn = request.ComparisonDatePosition is int configuredPosition
            ? dataset.Columns.SingleOrDefault(column => column.Position == configuredPosition)
            : dataset.Columns.OrderBy(column => column.Position)
                .FirstOrDefault(column => column.TypeName is "date" or "datetime");
        if (dateColumn?.TypeName is not ("date" or "datetime"))
        {
            var unfiltered = await ExecuteWithDiagnosticsAsync(dataset, request, cancellationToken);
            return unfiltered with { DateFilterApplicable = false };
        }

        if (dateRange is null)
        {
            var unfiltered = await ExecuteWithDiagnosticsAsync(dataset, request, cancellationToken);
            return unfiltered with { DateFilterApplicable = true };
        }

        if (dateRange.From > dateRange.To)
        {
            throw new InvalidDataException("The date range start must not be after its end.");
        }

        var currentRequest = AddDateRange(request, dateColumn.Position, dateRange.From, dateRange.To);
        var current = await ExecuteWithDiagnosticsAsync(dataset, currentRequest, cancellationToken);
        if (!includeComparison)
        {
            return current with { DateFilterApplicable = true };
        }

        var periodLength = dateRange.To.DayNumber - dateRange.From.DayNumber + 1;
        var previousTo = dateRange.From.AddDays(-1);
        var previousFrom = previousTo.AddDays(-(periodLength - 1));
        var previous = await ExecuteWithDiagnosticsAsync(
            dataset,
            AddDateRange(request, dateColumn.Position, previousFrom, previousTo),
            cancellationToken);
        var sparklineRequest = currentRequest with
        {
            GroupByPosition = null,
            GroupByPositions = [],
            TimeBucketPosition = dateColumn.Position,
            TimeBucket = "day",
            TopN = Math.Min(500, periodLength),
            SortBy = "groupValue",
            SortDirection = "asc"
        };
        var sparkline = await ExecuteWithDiagnosticsAsync(dataset, sparklineRequest, cancellationToken);
        var currentValue = SumMetric(current.Result);
        var previousValue = SumMetric(previous.Result);
        var percentChange = previousValue == 0
            ? currentValue == 0 ? 0m : (decimal?)null
            : (currentValue - previousValue) / Math.Abs(previousValue) * 100m;
        var values = sparkline.Result.Rows
            .Select(row => row.TryGetValue("m0", out var value) && value is not null
                ? Convert.ToDecimal(value, CultureInfo.InvariantCulture)
                : 0m)
            .ToArray();
        return current with
        {
            DateFilterApplicable = true,
            DurationMilliseconds = current.DurationMilliseconds + previous.DurationMilliseconds + sparkline.DurationMilliseconds,
            Comparison = new KpiComparison(previousValue, percentChange, values)
        };
    }

    public async Task<AnalyticsExecutionResult> ExecuteWithDiagnosticsAsync(
        Dataset dataset,
        DatasetAnalyticsRequest request,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        var plan = BuildPlan(dataset, request);
        var version = Convert.ToHexString(dataset.RowVersion);
        var columnLabels = string.Join('|', dataset.Columns.OrderBy(column => column.Position).Select(column => column.Name));
        var cacheKey = $"analytics:{dataset.Id:N}:{version}:{columnLabels}:{JsonSerializer.Serialize(request)}";
        if (cache.TryGetValue(cacheKey, out DatasetAnalyticsResult? cached) && cached is not null)
        {
            stopwatch.Stop();
            return new AnalyticsExecutionResult(cached, "HIT", stopwatch.Elapsed.TotalMilliseconds);
        }

        await using var connection = new SqlConnection(configuration.GetConnectionString("DefaultConnection"));
        var rows = await connection.QueryAsync(
            new CommandDefinition(plan.Sql, plan.Parameters, cancellationToken: cancellationToken));
        var resultRows = rows.Select(row =>
        {
            var values = (IDictionary<string, object>)row;
            return values.ToDictionary(
                item => item.Key,
                item => item.Value is DBNull ? null : item.Value,
                StringComparer.Ordinal);
        }).ToArray();
        var result = new DatasetAnalyticsResult(plan.Columns, resultRows);
        cache.Set(
            cacheKey,
            result,
            new MemoryCacheEntryOptions()
                .SetAbsoluteExpiration(CacheDuration)
                .SetSize(1));
        stopwatch.Stop();
        return new AnalyticsExecutionResult(result, "MISS", stopwatch.Elapsed.TotalMilliseconds);
    }

    private static AnalyticsSqlPlan BuildPlan(Dataset dataset, DatasetAnalyticsRequest request)
    {
        var columns = dataset.Columns.OrderBy(column => column.Position).ToArray();
        if (columns.Length == 0)
        {
            throw new InvalidDataException("This dataset does not have an imported schema yet.");
        }

        if (request.Metrics is null || request.Metrics.Length is < 1 or > 5)
        {
            throw new InvalidDataException("Choose between 1 and 5 aggregations.");
        }

        var filters = request.Filters ?? [];
        if (filters.Length > 20)
        {
            throw new InvalidDataException("A query can contain at most 20 filters.");
        }

        if (request.TopN is < 1 or > 500)
        {
            throw new InvalidDataException("Top N must be between 1 and 500.");
        }

        var groupPositions = request.GroupByPositions ?? (request.GroupByPosition is int legacyPosition ? [legacyPosition] : []);
        if (groupPositions.Length > 3 || groupPositions.Distinct().Count() != groupPositions.Length)
        {
            throw new InvalidDataException("Choose up to 3 different group-by columns.");
        }

        var groupColumns = groupPositions.Select(position => FindColumn(columns, position)).ToArray();
        DatasetColumn? timeColumn = null;
        if (request.TimeBucketPosition is int timePosition)
        {
            timeColumn = FindColumn(columns, timePosition);
            if (timeColumn.TypeName is not ("date" or "datetime") ||
                request.TimeBucket is not ("day" or "week" or "month" or "quarter" or "year"))
            {
                throw new InvalidDataException("Choose a date column and a supported time bucket.");
            }
        }
        else if (request.TimeBucket is not null)
        {
            throw new InvalidDataException("A time bucket requires a date column.");
        }

        if (request.ComparisonDatePosition is int comparisonPosition &&
            FindColumn(columns, comparisonPosition).TypeName is not ("date" or "datetime"))
        {
            throw new InvalidDataException("The comparison date column must be a date or datetime column.");
        }

        var groupExpressions = groupColumns
            .Select(column => $"[c{column.Position}]")
            .ToList();
        if (timeColumn is not null)
        {
            groupExpressions.Add(BuildTimeBucketExpression(timeColumn.Position, request.TimeBucket!));
        }

        var metricOffset = groupExpressions.Count;
        var metricColumns = new AnalyticsColumn[request.Metrics.Length + metricOffset];
        var selections = new List<string>();
        for (var index = 0; index < groupExpressions.Count; index++)
        {
            var key = index == 0 ? "groupValue" : $"groupValue{index}";
            var label = index < groupColumns.Length
                ? groupColumns[index].Name
                : $"{timeColumn!.Name} ({request.TimeBucket})";
            selections.Add($"{groupExpressions[index]} AS [{key}]");
            metricColumns[index] = new AnalyticsColumn(
                key,
                label,
                index == groupColumns.Length && timeColumn is not null ? "date" : groupColumns[index].TypeName);
        }

        for (var index = 0; index < request.Metrics.Length; index++)
        {
            var metric = request.Metrics[index];
            var function = metric.Function?.ToLowerInvariant();
            if (function is null || !AggregateFunctions.Contains(function))
            {
                throw new InvalidDataException($"Aggregation {index + 1} is not supported.");
            }

            DatasetColumn? column = null;
            if (metric.ColumnPosition is int position)
            {
                column = FindColumn(columns, position);
            }
            else if (function != "count")
            {
                throw new InvalidDataException("Sum, average, minimum, and maximum require a column.");
            }

            if ((function is "sum" or "avg") && column?.TypeName is not ("integer" or "decimal" or "number"))
            {
                throw new InvalidDataException($"'{function}' requires a numeric column.");
            }

            var source = column is null ? "*" : $"[c{column.Position}]";
            var label = $"{function.ToUpperInvariant()}({column?.Name ?? "*"})";
            var key = $"m{index}";
            selections.Add($"{function.ToUpperInvariant()}({source}) AS [{key}]");
            metricColumns[metricOffset + index] = new AnalyticsColumn(key, label, function == "count" ? "integer" : column?.TypeName ?? "number");
        }

        var parameters = new DynamicParameters();
        var whereClauses = new List<string>();
        for (var index = 0; index < filters.Length; index++)
        {
            var filter = filters[index];
            var column = FindColumn(columns, filter.ColumnPosition);
            var identifier = $"[c{column.Position}]";
            var operation = filter.Operator?.ToLowerInvariant();
            var parameterName = $"filter{index}";
            switch (operation)
            {
                case "isnull":
                    whereClauses.Add($"{identifier} IS NULL");
                    break;
                case "isnotnull":
                    whereClauses.Add($"{identifier} IS NOT NULL");
                    break;
                case "eq":
                case "neq":
                case "gt":
                case "gte":
                case "lt":
                case "lte":
                    var comparison = operation switch
                    {
                        "eq" => "=",
                        "neq" => "<>",
                        "gt" => ">",
                        "gte" => ">=",
                        "lt" => "<",
                        _ => "<="
                    };
                    whereClauses.Add($"{identifier} {comparison} @{parameterName}");
                    parameters.Add(parameterName, ParseFilterValue(column.TypeName, filter.Value));
                    break;
                case "contains":
                case "startswith":
                    if (column.TypeName != "text")
                    {
                        throw new InvalidDataException($"'{operation}' filters require a text column.");
                    }

                    var escapedValue = EscapeLike(filter.Value ?? string.Empty);
                    var pattern = operation == "contains" ? $"%{escapedValue}%" : $"{escapedValue}%";
                    whereClauses.Add($"{identifier} LIKE @{parameterName} ESCAPE '~'");
                    parameters.Add(parameterName, pattern);
                    break;
                default:
                    throw new InvalidDataException($"Filter operator {index + 1} is not supported.");
            }
        }

        parameters.Add("TopN", request.TopN);
        var whereSql = whereClauses.Count == 0 ? string.Empty : $"WHERE {string.Join(" AND ", whereClauses)}";
        var groupSql = groupExpressions.Count == 0 ? string.Empty : $"GROUP BY {string.Join(", ", groupExpressions)}";
        var direction = request.SortDirection.Equals("asc", StringComparison.OrdinalIgnoreCase)
            ? "ASC"
            : request.SortDirection.Equals("desc", StringComparison.OrdinalIgnoreCase)
                ? "DESC"
                : throw new InvalidDataException("Sort direction must be asc or desc.");
        var sortKey = request.SortBy ?? "m0";
        var validSortKeys = Enumerable.Range(0, request.Metrics.Length).Select(index => $"m{index}")
            .Concat(Enumerable.Range(0, groupExpressions.Count).Select(index => index == 0 ? "groupValue" : $"groupValue{index}"))
            .ToHashSet(StringComparer.Ordinal);
        if (!validSortKeys.Contains(sortKey))
        {
            throw new InvalidDataException("Choose a result column to sort by.");
        }

        var topClause = groupExpressions.Count == 0 ? "TOP (@TopN) " : string.Empty;
        var orderSql = groupExpressions.Count == 0
            ? string.Empty
            : $"ORDER BY [{sortKey}] {direction} OFFSET 0 ROWS FETCH NEXT @TopN ROWS ONLY";
        var sql = $"""
            SELECT {topClause}{string.Join(", ", selections)}
            FROM {DatasetCsvImporter.GetTableName(dataset.Id)}
            {whereSql}
            {groupSql}
            {orderSql};
            """;

        return new AnalyticsSqlPlan(sql, parameters, metricColumns);
    }

    private static string BuildTimeBucketExpression(int position, string bucket) =>
        bucket switch
        {
            "day" => $"CAST([c{position}] AS date)",
            "week" => $"DATEADD(day, -(DATEDIFF(day, CONVERT(date, '19000101'), CAST([c{position}] AS date)) % 7), CAST([c{position}] AS date))",
            "month" => $"DATEFROMPARTS(YEAR([c{position}]), MONTH([c{position}]), 1)",
            "quarter" => $"DATEFROMPARTS(YEAR([c{position}]), ((DATEPART(quarter, [c{position}]) - 1) * 3) + 1, 1)",
            "year" => $"DATEFROMPARTS(YEAR([c{position}]), 1, 1)",
            _ => throw new InvalidDataException("Choose a supported time bucket.")
        };

    private static DatasetAnalyticsRequest AddDateRange(
        DatasetAnalyticsRequest request,
        int position,
        DateOnly from,
        DateOnly to)
    {
        var filters = (request.Filters ?? [])
            .Where(filter => filter.ColumnPosition != position ||
                filter.Operator is not ("gte" or "gt" or "lt" or "lte"))
            .Append(new AnalyticsFilter(position, "gte", from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)))
            .Append(new AnalyticsFilter(position, "lt", to.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)))
            .ToArray();
        return request with { Filters = filters };
    }

    private static decimal SumMetric(DatasetAnalyticsResult result) =>
        result.Rows.Sum(row => row.TryGetValue("m0", out var value) && value is not null
            ? Convert.ToDecimal(value, CultureInfo.InvariantCulture)
            : 0m);

    private static DatasetColumn FindColumn(IReadOnlyCollection<DatasetColumn> columns, int position) =>
        columns.SingleOrDefault(column => column.Position == position)
        ?? throw new InvalidDataException("Choose a column from this dataset.");

    private static object ParseFilterValue(string typeName, string? value)
    {
        if (value is null)
        {
            throw new InvalidDataException("Filter values cannot be empty.");
        }

        try
        {
            return typeName switch
            {
                "integer" => long.Parse(value, NumberStyles.Integer, CultureInfo.InvariantCulture),
                "decimal" or "number" => decimal.Parse(value, NumberStyles.Number, CultureInfo.InvariantCulture),
                "boolean" => ParseBoolean(value),
                "date" => DateTime.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture),
                "datetime" => DateTime.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
                _ => value
            };
        }
        catch (Exception exception) when (exception is FormatException or OverflowException)
        {
            throw new InvalidDataException($"'{value}' is not a valid {typeName} filter value.");
        }
    }

    private static bool ParseBoolean(string value) =>
        value.Trim().ToLowerInvariant() switch
        {
            "true" or "yes" or "1" => true,
            "false" or "no" or "0" => false,
            _ => throw new FormatException()
        };

    private static string EscapeLike(string value) =>
        value.Replace("~", "~~", StringComparison.Ordinal)
            .Replace("%", "~%", StringComparison.Ordinal)
            .Replace("_", "~_", StringComparison.Ordinal)
            .Replace("[", "~[", StringComparison.Ordinal);

    private sealed record AnalyticsSqlPlan(
        string Sql,
        DynamicParameters Parameters,
        AnalyticsColumn[] Columns);
}

public sealed record AnalyticsExecutionResult(
    DatasetAnalyticsResult Result,
    string CacheStatus,
    double DurationMilliseconds,
    bool DateFilterApplicable = false,
    KpiComparison? Comparison = null);
