namespace DataLens.Domain.Entities;

public class SavedReport
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DatasetId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string QueryJson { get; set; } = string.Empty;
    public string ChartType { get; set; } = "bar";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public Dataset? Dataset { get; set; }
}
