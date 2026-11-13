namespace DataLens.Api.Imports;

public sealed class ImportFileStore
{
    private readonly string _rootDirectory;

    public ImportFileStore(IConfiguration configuration)
    {
        var configuredPath = configuration["Uploads:StoragePath"];
        var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        _rootDirectory = Path.GetFullPath(configuredPath
            ?? Path.Combine(localData, "DataLens", "imports"));
        Directory.CreateDirectory(_rootDirectory);
    }

    public string GetPath(Guid jobId) => Path.Combine(_rootDirectory, $"{jobId:N}.csv");

    public async Task StoreAsync(Guid jobId, Stream source, CancellationToken cancellationToken)
    {
        var path = GetPath(jobId);
        try
        {
            await using var target = new FileStream(
                path,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 64 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            await source.CopyToAsync(target, 64 * 1024, cancellationToken);
        }
        catch
        {
            Delete(jobId);
            throw;
        }
    }

    public void Delete(Guid jobId)
    {
        var path = GetPath(jobId);
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }
}
