using DataLens.Domain.Entities;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace DataLens.Infrastructure.Data;

public class AppDbContext : IdentityDbContext<AppUser>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Dataset> Datasets => Set<Dataset>();
    public DbSet<DatasetColumn> DatasetColumns => Set<DatasetColumn>();
    public DbSet<ImportError> ImportErrors => Set<ImportError>();
    public DbSet<ImportJob> ImportJobs => Set<ImportJob>();
    public DbSet<SavedReport> SavedReports => Set<SavedReport>();
    public DbSet<SavedChart> SavedCharts => Set<SavedChart>();
    public DbSet<Dashboard> Dashboards => Set<Dashboard>();
    public DbSet<DashboardWidget> DashboardWidgets => Set<DashboardWidget>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.Property(x => x.FirstName).HasMaxLength(120).IsRequired();
            entity.Property(x => x.LastName).HasMaxLength(120).IsRequired();
            entity.HasMany(x => x.Datasets)
                .WithOne(x => x.CreatedBy)
                .HasForeignKey(x => x.CreatedById)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Dataset>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(200).IsRequired();
            entity.Property(x => x.Description).HasMaxLength(500);
            entity.Property(x => x.FileName).HasMaxLength(300).IsRequired();
            entity.Property(x => x.RowVersion).IsRowVersion();

            entity.HasOne(x => x.CreatedBy)
                .WithMany(x => x.Datasets)
                .HasForeignKey(x => x.CreatedById)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(x => x.Columns)
                .WithOne(x => x.Dataset)
                .HasForeignKey(x => x.DatasetId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(x => x.ImportErrors)
                .WithOne(x => x.Dataset)
                .HasForeignKey(x => x.DatasetId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(x => x.Jobs)
                .WithOne(x => x.Dataset)
                .HasForeignKey(x => x.DatasetId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(x => x.Reports)
                .WithOne(x => x.Dataset)
                .HasForeignKey(x => x.DatasetId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DatasetColumn>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(200).IsRequired();
            entity.Property(x => x.TypeName).HasMaxLength(50).IsRequired();
            entity.HasIndex(x => new { x.DatasetId, x.Position });
        });

        modelBuilder.Entity<ImportError>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.ColumnName).HasMaxLength(200);
            entity.Property(x => x.RawValue).HasMaxLength(2_000);
            entity.Property(x => x.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(x => new { x.DatasetId, x.RowNumber });
        });

        modelBuilder.Entity<ImportJob>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.CreatedById).HasMaxLength(450).IsRequired();
            entity.Property(x => x.ErrorMessage).HasMaxLength(1000);
            entity.HasIndex(x => x.DatasetId);
            entity.HasIndex(x => x.Status);
        });

        modelBuilder.Entity<SavedReport>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(200).IsRequired();
            entity.Property(x => x.ChartType).HasMaxLength(50).IsRequired();
            entity.Property(x => x.QueryJson).HasColumnType("nvarchar(max)");
        });

        modelBuilder.Entity<SavedChart>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.OwnerId).HasMaxLength(450).IsRequired();
            entity.Property(x => x.Name).HasMaxLength(200).IsRequired();
            entity.Property(x => x.Description).HasMaxLength(1000);
            entity.Property(x => x.ChartType).HasMaxLength(50).IsRequired();
            entity.Property(x => x.QueryJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(x => x.OptionsJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(x => x.RowVersion).IsRowVersion();
            entity.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Dataset).WithMany(x => x.Charts).HasForeignKey(x => x.DatasetId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(x => new { x.OwnerId, x.UpdatedAt });
        });

        modelBuilder.Entity<Dashboard>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.OwnerId).HasMaxLength(450).IsRequired();
            entity.Property(x => x.Name).HasMaxLength(200).IsRequired();
            entity.Property(x => x.RowVersion).IsRowVersion();
            entity.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(x => x.Widgets).WithOne(x => x.Dashboard).HasForeignKey(x => x.DashboardId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(x => new { x.OwnerId, x.IsDefault });
        });

        modelBuilder.Entity<DashboardWidget>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.TitleOverride).HasMaxLength(200);
            entity.HasOne(x => x.SavedChart).WithMany(x => x.Widgets).HasForeignKey(x => x.SavedChartId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(x => new { x.DashboardId, x.Y, x.X });
            entity.HasIndex(x => new { x.DashboardId, x.SavedChartId }).IsUnique();
        });
    }
}
