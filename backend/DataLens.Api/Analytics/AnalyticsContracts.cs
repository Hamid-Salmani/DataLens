namespace DataLens.Api.Analytics;

public sealed record DatasetAnalyticsRequest(
    int? GroupByPosition,
    AnalyticsMetric[] Metrics,
    AnalyticsFilter[]? Filters = null,
    int TopN = 100,
    int[]? GroupByPositions = null,
    string? SortBy = null,
    string SortDirection = "desc",
    int? TimeBucketPosition = null,
    string? TimeBucket = null,
    int? ComparisonDatePosition = null);

public sealed record AnalyticsMetric(string Function, int? ColumnPosition);

public sealed record AnalyticsFilter(int ColumnPosition, string Operator, string? Value);

public sealed record AnalyticsColumn(string Key, string Label, string TypeName);

public sealed record DatasetAnalyticsResult(AnalyticsColumn[] Columns, Dictionary<string, object?>[] Rows);

public sealed record SavedReportRequest(
    string? Name,
    string? ChartType,
    DatasetAnalyticsRequest? Query);

public sealed record SavedReportResponse(
    Guid Id,
    Guid DatasetId,
    string Name,
    string ChartType,
    DatasetAnalyticsRequest Query,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record SavedChartRequest(
    string? Name,
    string? Description,
    Guid DatasetId,
    string? ChartType,
    DatasetAnalyticsRequest? Query,
    ChartVisualOptions? Options);

public sealed record ChartVisualOptions(
    string? Title = null,
    string? XAxisLabel = null,
    string? YAxisLabel = null,
    bool ShowLegend = true,
    bool Stacked = false,
    string[]? Colors = null,
    string NumberFormat = "auto",
    string GoodDirection = "up");

public sealed record SavedChartResponse(
    Guid Id,
    Guid DatasetId,
    string DatasetName,
    string Name,
    string Description,
    string ChartType,
    DatasetAnalyticsRequest Query,
    ChartVisualOptions Options,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string Version);

public sealed record AnalyticsDateRange(DateOnly From, DateOnly To);
public sealed record KpiComparison(decimal? PreviousValue, decimal? PercentChange, decimal[] Sparkline);
public sealed record ChartPreviewRequest(
    Guid DatasetId,
    string ChartType,
    DatasetAnalyticsRequest Query,
    AnalyticsDateRange? DateRange = null);
public sealed record ChartPreviewResponse(
    DatasetAnalyticsResult Result,
    string CacheStatus,
    double DurationMilliseconds,
    bool DateFilterApplicable = false,
    KpiComparison? Comparison = null);

public sealed record DashboardRequest(string? Name);
public sealed record DashboardWidgetRequest(Guid SavedChartId, int X, int Y, int Width, int Height, string? TitleOverride = null);
public sealed record DashboardLayoutRequest(string Version, DashboardWidgetRequest[] Widgets);
public sealed record DashboardWidgetResponse(Guid Id, Guid SavedChartId, int X, int Y, int Width, int Height, string? TitleOverride, SavedChartResponse Chart);
public sealed record DashboardResponse(Guid Id, string Name, bool IsDefault, DashboardWidgetResponse[] Widgets, string Version);
