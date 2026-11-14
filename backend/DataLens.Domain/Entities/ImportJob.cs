namespace DataLens.Domain.Entities;

public enum JobStatus
{
    Queued = 0,
    Running = 1,
    Completed = 2,
    Failed = 3,
    Cancelled = 4
}

public class ImportJob
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DatasetId { get; set; }
    public string CreatedById { get; set; } = string.Empty;
    public JobStatus Status { get; set; } = JobStatus.Queued;
    public int Progress { get; set; }
    public long RowsProcessed { get; set; }
    public long RowsSkipped { get; set; }
    public long FileSizeBytes { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    public Dataset? Dataset { get; set; }
}
