namespace DataLens.Domain.Entities;

public class ImportError
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DatasetId { get; set; }
    public long RowNumber { get; set; }
    public string? ColumnName { get; set; }
    public string? RawValue { get; set; }
    public string Reason { get; set; } = string.Empty;

    public Dataset? Dataset { get; set; }
}
