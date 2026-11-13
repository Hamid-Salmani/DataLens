namespace DataLens.Domain.Entities;

public class SavedChart
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string OwnerId { get; set; } = string.Empty;
    public Guid DatasetId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string ChartType { get; set; } = "bar";
    public string QueryJson { get; set; } = "{}";
    public string OptionsJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public byte[] RowVersion { get; set; } = Array.Empty<byte>();

    public AppUser? Owner { get; set; }
    public Dataset? Dataset { get; set; }
    public ICollection<DashboardWidget> Widgets { get; set; } = new List<DashboardWidget>();
}
