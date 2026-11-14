using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Tests.Infrastructure;

public class AppDbContextTests : IClassFixture<TestDatabaseFixture>
{
    private readonly TestDatabaseFixture _fixture;

    public AppDbContextTests(TestDatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task CanCreateAndQueryDatasetMetadata()
    {
        await using var context = _fixture.CreateContext();

        var user = new AppUser
        {
            Id = "user-1",
            UserName = "alex",
            Email = "alex@example.com",
            FirstName = "Alex",
            LastName = "Smith"
        };

        context.Users.Add(user);
        await context.SaveChangesAsync();

        var dataset = new Dataset
        {
            Name = "Sales",
            FileName = "sales.csv",
            CreatedById = user.Id,
            Columns =
            {
                new DatasetColumn { Name = "Date", TypeName = "datetime", Position = 0 },
                new DatasetColumn { Name = "Revenue", TypeName = "decimal", Position = 1 }
            }
        };

        context.Datasets.Add(dataset);
        await context.SaveChangesAsync();

        var dbDataset = await context.Datasets
            .Include(x => x.Columns)
            .SingleAsync(x => x.Id == dataset.Id);

        dbDataset.Name.Should().Be("Sales");
        dbDataset.Columns.Should().HaveCount(2);
    }
}
