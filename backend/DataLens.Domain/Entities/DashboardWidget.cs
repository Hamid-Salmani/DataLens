namespace DataLens.Domain.Entities;

public class DashboardWidget
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DashboardId { get; set; }
    public Guid SavedChartId { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; } = 6;
    public int Height { get; set; } = 4;
    public string? TitleOverride { get; set; }

    public Dashboard? Dashboard { get; set; }
    public SavedChart? SavedChart { get; set; }
}
