using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DataLens.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class SavedChartsAndDashboards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Dashboards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    IsDefault = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Dashboards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Dashboards_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SavedCharts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    DatasetId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    ChartType = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    QueryJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    OptionsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedCharts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SavedCharts_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SavedCharts_Datasets_DatasetId",
                        column: x => x.DatasetId,
                        principalTable: "Datasets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DashboardWidgets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DashboardId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SavedChartId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    X = table.Column<int>(type: "int", nullable: false),
                    Y = table.Column<int>(type: "int", nullable: false),
                    Width = table.Column<int>(type: "int", nullable: false),
                    Height = table.Column<int>(type: "int", nullable: false),
                    TitleOverride = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DashboardWidgets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DashboardWidgets_Dashboards_DashboardId",
                        column: x => x.DashboardId,
                        principalTable: "Dashboards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DashboardWidgets_SavedCharts_SavedChartId",
                        column: x => x.SavedChartId,
                        principalTable: "SavedCharts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Dashboards_OwnerId_IsDefault",
                table: "Dashboards",
                columns: new[] { "OwnerId", "IsDefault" });

            migrationBuilder.CreateIndex(
                name: "IX_DashboardWidgets_DashboardId_SavedChartId",
                table: "DashboardWidgets",
                columns: new[] { "DashboardId", "SavedChartId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DashboardWidgets_DashboardId_Y_X",
                table: "DashboardWidgets",
                columns: new[] { "DashboardId", "Y", "X" });

            migrationBuilder.CreateIndex(
                name: "IX_DashboardWidgets_SavedChartId",
                table: "DashboardWidgets",
                column: "SavedChartId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedCharts_DatasetId",
                table: "SavedCharts",
                column: "DatasetId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedCharts_OwnerId_UpdatedAt",
                table: "SavedCharts",
                columns: new[] { "OwnerId", "UpdatedAt" });

            migrationBuilder.Sql("""
                INSERT INTO [dbo].[SavedCharts]
                    ([Id], [OwnerId], [DatasetId], [Name], [Description], [ChartType], [QueryJson], [OptionsJson], [CreatedAt], [UpdatedAt])
                SELECT report.[Id], dataset.[CreatedById], report.[DatasetId], report.[Name], N'', report.[ChartType],
                    report.[QueryJson], N'{"showLegend":true,"stacked":false,"numberFormat":"auto"}',
                    report.[CreatedAt], report.[UpdatedAt]
                FROM [dbo].[SavedReports] AS report
                INNER JOIN [dbo].[Datasets] AS dataset ON dataset.[Id] = report.[DatasetId]
                WHERE NOT EXISTS (SELECT 1 FROM [dbo].[SavedCharts] AS chart WHERE chart.[Id] = report.[Id]);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DashboardWidgets");

            migrationBuilder.DropTable(
                name: "Dashboards");

            migrationBuilder.DropTable(
                name: "SavedCharts");
        }
    }
}
