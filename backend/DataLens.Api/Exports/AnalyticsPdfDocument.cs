using System.Globalization;
using DataLens.Api.Analytics;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace DataLens.Api.Exports;

public sealed record PdfExportSection(
    string Title,
    string DatasetName,
    string ChartType,
    DatasetAnalyticsResult Result,
    KpiComparison? Comparison);

public static class AnalyticsPdfDocument
{
    public static void Generate(
        string path,
        string title,
        DateOnly? from,
        DateOnly? to,
        IReadOnlyList<PdfExportSection> sections)
    {
        Document.Create(document =>
        {
            document.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(1.5f, Unit.Centimetre);
                page.DefaultTextStyle(style => style.FontSize(9));
                page.Header().Column(header =>
                {
                    header.Item().Text(title).FontSize(22).Bold().FontColor(Colors.Blue.Darken2);
                    header.Item().Text(from.HasValue && to.HasValue
                        ? $"Date range: {from:yyyy-MM-dd} to {to:yyyy-MM-dd}"
                        : $"Generated: {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC")
                        .FontSize(9).FontColor(Colors.Grey.Darken1);
                });
                page.Content().PaddingVertical(12).Column(content =>
                {
                    content.Spacing(16);
                    if (sections.Count == 0)
                    {
                        content.Item().Text("This dashboard does not contain any charts.")
                            .FontColor(Colors.Grey.Darken1);
                    }

                    foreach (var section in sections)
                    {
                        content.Item().Column(chart =>
                        {
                            chart.Spacing(5);
                            chart.Item().Text(section.Title).FontSize(15).Bold();
                            chart.Item().Text($"{section.DatasetName} · {section.ChartType}")
                                .FontSize(8).FontColor(Colors.Grey.Darken1);
                            if (section.Comparison is { } comparison)
                            {
                                var change = comparison.PercentChange.HasValue
                                    ? $"{comparison.PercentChange.Value.ToString("0.##", CultureInfo.InvariantCulture)}% vs previous period"
                                    : "No previous-period baseline";
                                chart.Item().Text($"Previous value: {Format(comparison.PreviousValue)} · Change: {change}")
                                    .FontSize(9).FontColor(Colors.Grey.Darken2);
                            }

                            if (section.Result.Rows.Length == 0)
                            {
                                chart.Item().Text("No data for this chart.").Italic().FontColor(Colors.Grey.Darken1);
                                return;
                            }

                            chart.Item().Table(table =>
                            {
                                table.ColumnsDefinition(columns =>
                                {
                                    foreach (var _ in section.Result.Columns) columns.RelativeColumn();
                                });
                                table.Header(headerRow =>
                                {
                                    foreach (var column in section.Result.Columns)
                                    {
                                        headerRow.Cell().Element(HeaderCell).Text(column.Label).SemiBold();
                                    }
                                });
                                foreach (var row in section.Result.Rows)
                                {
                                    foreach (var column in section.Result.Columns)
                                    {
                                        var value = row.TryGetValue(column.Key, out var item) ? Format(item) : string.Empty;
                                        table.Cell().Element(BodyCell).Text(value);
                                    }
                                }
                            });
                        });
                    }
                });
                page.Footer().AlignCenter().Text(text =>
                {
                    text.Span("Page ");
                    text.CurrentPageNumber();
                    text.Span(" of ");
                    text.TotalPages();
                });
            });
        }).GeneratePdf(path);
    }

    private static IContainer HeaderCell(IContainer container) =>
        container.Background(Colors.Blue.Darken2).Padding(5).DefaultTextStyle(style => style.FontColor(Colors.White));

    private static IContainer BodyCell(IContainer container) =>
        container.BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(5);

    private static string Format(object? value) => value switch
    {
        null => "—",
        DateTime dateTime => dateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        bool boolean => boolean ? "true" : "false",
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty
    };
}
