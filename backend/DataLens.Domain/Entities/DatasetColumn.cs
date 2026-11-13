namespace DataLens.Domain.Entities;

public class DatasetColumn
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DatasetId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string TypeName { get; set; } = "string";
    public bool IsNullable { get; set; } = true;
    public int Position { get; set; }

    public Dataset? Dataset { get; set; }
}
