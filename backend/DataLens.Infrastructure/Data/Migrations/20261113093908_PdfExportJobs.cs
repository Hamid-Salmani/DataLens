using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataLens.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class PdfExportJobs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "DatasetId",
                table: "ExportJobs",
                type: "uniqueidentifier",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier");

            migrationBuilder.AddColumn<Guid>(
                name: "DashboardId",
                table: "ExportJobs",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "FromDate",
                table: "ExportJobs",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SavedChartId",
                table: "ExportJobs",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetName",
                table: "ExportJobs",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateOnly>(
                name: "ToDate",
                table: "ExportJobs",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Type",
                table: "ExportJobs",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("""
                UPDATE exportJob
                SET TargetName = dataset.Name
                FROM ExportJobs AS exportJob
                INNER JOIN Datasets AS dataset ON dataset.Id = exportJob.DatasetId
                WHERE exportJob.TargetName = N'';
                """);

            migrationBuilder.CreateIndex(
                name: "IX_ExportJobs_DashboardId",
                table: "ExportJobs",
                column: "DashboardId");

            migrationBuilder.CreateIndex(
                name: "IX_ExportJobs_SavedChartId",
                table: "ExportJobs",
                column: "SavedChartId");

            migrationBuilder.AddForeignKey(
                name: "FK_ExportJobs_Dashboards_DashboardId",
                table: "ExportJobs",
                column: "DashboardId",
                principalTable: "Dashboards",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_ExportJobs_SavedCharts_SavedChartId",
                table: "ExportJobs",
                column: "SavedChartId",
                principalTable: "SavedCharts",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ExportJobs_Dashboards_DashboardId",
                table: "ExportJobs");

            migrationBuilder.DropForeignKey(
                name: "FK_ExportJobs_SavedCharts_SavedChartId",
                table: "ExportJobs");

            migrationBuilder.DropIndex(
                name: "IX_ExportJobs_DashboardId",
                table: "ExportJobs");

            migrationBuilder.DropIndex(
                name: "IX_ExportJobs_SavedChartId",
                table: "ExportJobs");

            migrationBuilder.DropColumn(
                name: "DashboardId",
                table: "ExportJobs");

            migrationBuilder.DropColumn(
                name: "FromDate",
                table: "ExportJobs");

            migrationBuilder.DropColumn(
                name: "SavedChartId",
                table: "ExportJobs");

            migrationBuilder.DropColumn(
                name: "TargetName",
                table: "ExportJobs");

            migrationBuilder.DropColumn(
                name: "ToDate",
                table: "ExportJobs");

            migrationBuilder.DropColumn(
                name: "Type",
                table: "ExportJobs");

            migrationBuilder.AlterColumn<Guid>(
                name: "DatasetId",
                table: "ExportJobs",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier",
                oldNullable: true);
        }
    }
}
