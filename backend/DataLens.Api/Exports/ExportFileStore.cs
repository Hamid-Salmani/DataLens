using DataLens.Domain.Entities;

namespace DataLens.Api.Exports;

public sealed class ExportFileStore(IConfiguration configuration, IHostEnvironment environment)
{
    private readonly string _directory = Path.GetFullPath(
        configuration["Exports:Directory"] ?? Path.Combine(environment.ContentRootPath, "App_Data", "exports"));

    public string GetPath(ExportJob job) =>
        Path.Combine(_directory, $"{job.Id:N}{GetExtension(job.Type)}");

    public void Delete(ExportJob job)
    {
        var path = GetPath(job);
        if (File.Exists(path)) File.Delete(path);
    }

    public void EnsureDirectory() => Directory.CreateDirectory(_directory);

    public static string GetExtension(ExportJobType type) => type switch
    {
        ExportJobType.DatasetCsv => ".csv",
        ExportJobType.ChartPdf or ExportJobType.DashboardPdf => ".pdf",
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unsupported export format.")
    };
}
