namespace DataLens.Domain.Entities;

public class Dashboard
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string OwnerId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsDefault { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public byte[] RowVersion { get; set; } = Array.Empty<byte>();

    public AppUser? Owner { get; set; }
    public ICollection<DashboardWidget> Widgets { get; set; } = new List<DashboardWidget>();
}
