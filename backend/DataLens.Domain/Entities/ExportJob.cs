namespace DataLens.Domain.Entities;

public enum ExportJobStatus
{
    Queued = 0,
    Running = 1,
    Completed = 2,
    Failed = 3
}

public enum ExportJobType
{
    DatasetCsv = 0,
    ChartPdf = 1,
    DashboardPdf = 2
}

public class ExportJob
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string OwnerId { get; set; } = string.Empty;
    public Guid? DatasetId { get; set; }
    public Guid? SavedChartId { get; set; }
    public Guid? DashboardId { get; set; }
    public DateOnly? FromDate { get; set; }
    public DateOnly? ToDate { get; set; }
    public ExportJobType Type { get; set; } = ExportJobType.DatasetCsv;
    public string TargetName { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public ExportJobStatus Status { get; set; } = ExportJobStatus.Queued;
    public int Progress { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }

    public AppUser? Owner { get; set; }
    public Dataset? Dataset { get; set; }
    public SavedChart? SavedChart { get; set; }
    public Dashboard? Dashboard { get; set; }
}
