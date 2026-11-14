using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataLens.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class ImportJobRuntime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "FileSizeBytes",
                table: "ImportJobs",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "RowsSkipped",
                table: "ImportJobs",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTime>(
                name: "StartedAt",
                table: "ImportJobs",
                type: "datetime2",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FileSizeBytes",
                table: "ImportJobs");

            migrationBuilder.DropColumn(
                name: "RowsSkipped",
                table: "ImportJobs");

            migrationBuilder.DropColumn(
                name: "StartedAt",
                table: "ImportJobs");
        }
    }
}
