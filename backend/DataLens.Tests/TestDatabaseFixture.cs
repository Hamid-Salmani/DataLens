using DataLens.Infrastructure.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Tests;

public sealed class TestDatabaseFixture : IDisposable
{
    public string DatabaseName { get; } = $"DataLens_Test_{Guid.NewGuid():N}";
    private readonly string _baseConnectionString =
        Environment.GetEnvironmentVariable("DATALENS_TEST_CONNECTION")
        ?? "Server=(localdb)\\MSSQLLocalDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True";
    public string ConnectionString => new SqlConnectionStringBuilder(_baseConnectionString)
    {
        InitialCatalog = DatabaseName
    }.ConnectionString;

    public AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer(ConnectionString)
            .Options;

        var context = new AppDbContext(options);
        context.Database.EnsureCreated();
        return context;
    }

    public void Dispose()
    {
        using var context = CreateContext();
        context.Database.EnsureDeleted();
    }
}
