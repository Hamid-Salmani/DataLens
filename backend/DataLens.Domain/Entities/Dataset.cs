namespace DataLens.Domain.Entities;

public class Dataset
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public long RowCount { get; set; }
    public long SkippedRows { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public byte[] RowVersion { get; set; } = Array.Empty<byte>();

    public string CreatedById { get; set; } = string.Empty;
    public AppUser? CreatedBy { get; set; }

    public ICollection<DatasetColumn> Columns { get; set; } = new List<DatasetColumn>();
    public ICollection<ImportError> ImportErrors { get; set; } = new List<ImportError>();
    public ICollection<ImportJob> Jobs { get; set; } = new List<ImportJob>();
    public ICollection<SavedReport> Reports { get; set; } = new List<SavedReport>();
    public ICollection<SavedChart> Charts { get; set; } = new List<SavedChart>();
}
