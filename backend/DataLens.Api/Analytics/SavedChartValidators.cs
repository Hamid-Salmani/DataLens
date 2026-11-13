using FluentValidation;

namespace DataLens.Api.Analytics;

public sealed class SavedChartRequestValidator : AbstractValidator<SavedChartRequest>
{
    public SavedChartRequestValidator()
    {
        RuleFor(request => request.Name).NotEmpty().MaximumLength(200);
        RuleFor(request => request.Description).MaximumLength(1000);
        RuleFor(request => request.DatasetId).NotEmpty();
        RuleFor(request => request.ChartType)
            .Must(type => type is not null && ChartTypes.All.Contains(type, StringComparer.OrdinalIgnoreCase))
            .WithMessage("Choose a supported chart type.");
        RuleFor(request => request.Query).NotNull();
        RuleFor(request => request.Options).NotNull();
        RuleForEach(request => request.Options!.Colors!)
            .Matches("^#[0-9a-fA-F]{6}$")
            .When(request => request.Options?.Colors is not null);
        RuleFor(request => request.Options!.NumberFormat)
            .Must(format => format is "auto" or "number" or "integer" or "percent" or "currency")
            .When(request => request.Options is not null);
        RuleFor(request => request.Options!.GoodDirection)
            .Must(direction => direction is "up" or "down")
            .When(request => request.Options is not null);
    }
}

public sealed class DashboardRequestValidator : AbstractValidator<DashboardRequest>
{
    public DashboardRequestValidator() => RuleFor(request => request.Name).NotEmpty().MaximumLength(200);
}

public static class ChartTypes
{
    public static readonly string[] All =
    [
        "bar", "horizontal-bar", "stacked-bar", "line", "multi-line", "area", "stacked-area",
        "pie", "donut", "scatter", "kpi", "table"
    ];
}
