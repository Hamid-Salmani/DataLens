using System.Text;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using DataLens.Infrastructure.Imports;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace DataLens.Tests.Infrastructure;

public class DatasetCsvImporterTests : IClassFixture<TestDatabaseFixture>
{
    private readonly TestDatabaseFixture _fixture;

    public DatasetCsvImporterTests(TestDatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task ImportsCsvRowsIntoTypedDatasetTable()
    {
        await using var db = _fixture.CreateContext();
        var user = new AppUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = $"{Guid.NewGuid():N}@example.test",
            Email = $"{Guid.NewGuid():N}@example.test",
            FirstName = "Test",
            LastName = "User"
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _fixture.ConnectionString
            })
            .Build();
        var importer = new DatasetCsvImporter(db, configuration);
        await using var csv = new MemoryStream(Encoding.UTF8.GetBytes(
            "Customer,Amount,Active,Created\nAcme,12.50,true,2025-01-03\nNorthwind,7.25,false,2025-01-04\n"));

        var result = await importer.ImportAsync(csv, "sales.csv", "Sales", user.Id, CancellationToken.None);
        var dataset = result.Dataset;

        dataset.RowCount.Should().Be(2);
        result.RowsSkipped.Should().Be(0);
        dataset.Columns.Select(column => column.TypeName)
            .Should().Equal("text", "decimal", "boolean", "date");

        await using var connection = new SqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        var rowCount = await new SqlCommand(
            $"SELECT COUNT_BIG(*) FROM {DatasetCsvImporter.GetTableName(dataset.Id)}",
            connection).ExecuteScalarAsync();
        Convert.ToInt64(rowCount).Should().Be(2);
        await importer.DropTableAsync(dataset.Id, CancellationToken.None);
    }

    [Fact]
    public async Task AddsInferredColumnsWhenImportingIntoAnAlreadyTrackedDataset()
    {
        await using var db = _fixture.CreateContext();
        var email = $"{Guid.NewGuid():N}@example.test";
        var user = new AppUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = email,
            Email = email,
            FirstName = "Test",
            LastName = "User"
        };
        var dataset = new Dataset
        {
            Name = "Tracked dataset",
            FileName = "tracked.csv",
            CreatedById = user.Id
        };
        db.Users.Add(user);
        db.Datasets.Add(dataset);
        await db.SaveChangesAsync();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _fixture.ConnectionString
            })
            .Build();
        var importer = new DatasetCsvImporter(db, configuration);
        var trackedDataset = await db.Datasets
            .Include(item => item.Columns)
            .SingleAsync(item => item.Id == dataset.Id);
        await using var csv = new MemoryStream(Encoding.UTF8.GetBytes("Name,Amount\nAcme,12\n"));

        var result = await importer.ImportIntoAsync(
            csv,
            trackedDataset,
            csv.Length,
            CancellationToken.None);

        result.Dataset.Columns.Select(column => column.Name).Should().Equal("Name", "Amount");
        (await db.DatasetColumns.CountAsync(column => column.DatasetId == dataset.Id)).Should().Be(2);
        await importer.DropTableAsync(dataset.Id, CancellationToken.None);
    }

    [Fact]
    public async Task SkipsRowsThatDoNotMatchTheInferredColumnType()
    {
        await using var db = _fixture.CreateContext();
        var email = $"{Guid.NewGuid():N}@example.test";
        var user = new AppUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = email,
            Email = email,
            FirstName = "Test",
            LastName = "User"
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _fixture.ConnectionString
            })
            .Build();
        var importer = new DatasetCsvImporter(db, configuration);
        var rows = string.Join('\n', Enumerable.Range(1, 1_000).Select(value => value.ToString()));
        await using var csv = new MemoryStream(Encoding.UTF8.GetBytes($"Amount\n{rows}\nnot-a-number\n"));

        var result = await importer.ImportAsync(csv, "amounts.csv", "Amounts", user.Id, CancellationToken.None);

        result.Dataset.RowCount.Should().Be(1_000);
        result.RowsSkipped.Should().Be(1);
        await importer.DropTableAsync(result.Dataset.Id, CancellationToken.None);
    }

    [Fact]
    public async Task RecordsEveryInvalidCellAndMalformedRowFromTheTwoHundredRowFixture()
    {
        await using var db = _fixture.CreateContext();
        var email = $"{Guid.NewGuid():N}@example.test";
        var user = new AppUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = email,
            Email = email,
            FirstName = "Test",
            LastName = "User"
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _fixture.ConnectionString
            })
            .Build();
        var importer = new DatasetCsvImporter(db, configuration);
        var fixturePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "invalid-import-200.csv");
        await using var csv = File.OpenRead(fixturePath);

        var result = await importer.ImportAsync(csv, "invalid-import-200.csv", "Validation fixture", user.Id, CancellationToken.None);
        var errors = await db.ImportErrors
            .Where(error => error.DatasetId == result.Dataset.Id)
            .OrderBy(error => error.RowNumber)
            .ToListAsync();

        result.Dataset.RowCount.Should().Be(193);
        result.RowsSkipped.Should().Be(7);
        result.ErrorCount.Should().Be(7);
        result.Dataset.Columns.Select(column => column.TypeName)
            .Should().Equal("text", "decimal", "integer", "boolean", "date");
        errors.Should().HaveCount(7);
        errors.Where(error => error.ColumnName == "Amount")
            .Select(error => error.RawValue)
            .Should().BeEquivalentTo("three", "N/A", "12,5x");
        errors.Should().Contain(error => error.ColumnName == "Enabled" && error.RawValue == "maybe");
        errors.Should().Contain(error => error.ColumnName == "Date" && error.RawValue == "not-a-date");
        errors.Should().Contain(error => error.ColumnName == "Date" && error.RawValue == "2025-13-45");
        errors.Should().Contain(error => error.ColumnName == null && error.Reason.Contains("Expected 5 fields"));

        await importer.DropTableAsync(result.Dataset.Id, CancellationToken.None);
    }

    [Fact]
    public async Task InfersSalesWithErrorsColumnTypesAndRecordsEveryUnparseableValue()
    {
        await using var db = _fixture.CreateContext();
        var email = $"{Guid.NewGuid():N}@example.test";
        var user = new AppUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = email,
            Email = email,
            FirstName = "Test",
            LastName = "User"
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _fixture.ConnectionString
            })
            .Build();
        var importer = new DatasetCsvImporter(db, configuration);
        var fixturePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "sales_with_errors.csv");
        await using var csv = File.OpenRead(fixturePath);

        var result = await importer.ImportAsync(csv, "sales_with_errors.csv", "Sales with errors", user.Id, CancellationToken.None);
        var errors = await db.ImportErrors
            .Where(error => error.DatasetId == result.Dataset.Id)
            .OrderBy(error => error.RowNumber)
            .ToListAsync();

        result.Dataset.RowCount.Should().Be(194);
        result.RowsSkipped.Should().Be(6);
        result.ErrorCount.Should().Be(6);
        result.Dataset.Columns.Select(column => column.TypeName)
            .Should().Equal("integer", "integer", "decimal", "decimal", "date", "boolean", "text");
        errors.Select(error => new { error.RowNumber, error.ColumnName, error.RawValue })
            .Should().BeEquivalentTo(
            [
                new { RowNumber = 17L, ColumnName = "quantity", RawValue = "many" },
                new { RowNumber = 40L, ColumnName = "unit_price", RawValue = "N/A" },
                new { RowNumber = 74L, ColumnName = "total_amount", RawValue = "broken-total" },
                new { RowNumber = 112L, ColumnName = "order_date", RawValue = "not-a-date" },
                new { RowNumber = 149L, ColumnName = "is_returned", RawValue = "maybe" },
                new { RowNumber = 181L, ColumnName = "quantity", RawValue = "?" }
            ]);
        errors.Should().OnlyContain(error => !string.IsNullOrWhiteSpace(error.Reason));

        await importer.DropTableAsync(result.Dataset.Id, CancellationToken.None);
    }
}
