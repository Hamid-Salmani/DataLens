# DataLens

DataLens is a .NET 8 + React project for importing, inspecting, and analyzing CSV datasets. It includes account registration/login, owner-scoped datasets, asynchronous CSV imports to dataset-specific SQL Server tables, paged previews, reusable saved charts, and dashboards that compose charts across datasets.

## Requirements

- .NET 8 SDK
- Node.js 20+
- SQL Server LocalDB, Express, or Developer Edition

No containers are required.

## Run locally

1. Start the `MSSQLLocalDB` instance if needed:

```powershell
sqllocaldb start MSSQLLocalDB
```

2. The development connection string is in `backend/DataLens.Api/appsettings.Development.json`:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=DataLens;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
  }
}
```

Replace it with a SQL Server Express/Developer connection string if LocalDB is unavailable. The API applies EF Core migrations automatically only in Development. Configure `Jwt:SigningKey` with a private value of at least 32 characters outside Development.

3. Start the API:

```powershell
cd D:\DataLens\backend
dotnet restore DataLens.slnx
dotnet run --project DataLens.Api
```

The API listens on `http://localhost:5000`. Swagger is available at `/swagger`, and the SQL Server health check is at `/health`.
If sign-up or sign-in shows that the API is unavailable (or a 502 response), keep this API process running and verify `http://localhost:5000/health` before retrying from the frontend.

To save the current Swagger document to `backend/openapi.json`, keep the API running and execute:

```powershell
.\backend\scripts\export-openapi.ps1
cd D:\DataLens\frontend
npm run api:types
```

The second command regenerates `frontend/src/lib/openapi.generated.ts` from the saved API contract.

4. In a second terminal, start the frontend:

```powershell
cd D:\DataLens\frontend
npm ci
npm run dev
```

Open `http://localhost:5173`, select **Launch dashboard**, create an account, and import a `.csv` file (up to 200 MB by default). The workspace routes are `/` (dashboard), `/datasets`, `/charts`, and `/datasets/{id}`. Create a chart from the Charts page or directly from a dataset, then add saved charts from any dataset to a dashboard. Dashboard layout changes use optimistic concurrency and report conflicts rather than overwriting another session's changes. Set `Uploads:MaxFileSizeBytes` for the server and `VITE_MAX_UPLOAD_BYTES` in `frontend/.env` to the same byte count to change the limit. `ImportJobs:QueueCapacity` and `ImportJobs:Concurrency` configure the bounded in-memory worker queue; `Uploads:StoragePath` can set the directory used for queued source files. Vite proxies `/api`, `/health`, and the SignalR `/hubs` endpoint to the backend.

Use `samples/sales.csv` for a small import, or generate a larger file with `.\samples\generate-large-csv.ps1 -Size 1m`.

## Current API surface

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/dashboard/summary`
- `GET /api/datasets`, `POST /api/datasets`, `GET /api/datasets/{id}`
- `GET /api/datasets/{id}/preview?page=1&pageSize=50&sortBy=Amount&sortDirection=desc`
- `PUT /api/datasets/{id}/columns/{position}`
- `POST /api/datasets/{id}/analytics`
- `GET|POST /api/charts`, `GET|PUT|DELETE /api/charts/{id}`
- `POST /api/charts/preview`, `GET /api/charts/{id}/preview`
- `GET|POST /api/dashboards`, `GET|PUT|DELETE /api/dashboards/{id}`
- `POST /api/dashboards/{id}/default`
- `POST /api/dashboards/{id}/widgets`, `DELETE /api/dashboards/{id}/widgets/{widgetId}`
- `PUT /api/dashboards/{id}/layout`
- `GET|POST /api/datasets/{id}/reports`
- `PUT|DELETE /api/datasets/{id}/reports/{reportId}`
- `POST /api/datasets/{id}/reports/{reportId}/run`
- `GET /api/datasets/{id}/import-errors`, `GET /api/datasets/{id}/import-errors.csv`
- `DELETE /api/datasets/{id}`
- `GET /api/import-jobs`, `GET /api/import-jobs/{id}`
- `POST /api/import-jobs/{id}/cancel`, `POST /api/import-jobs/{id}/retry`
- SignalR hub: `/hubs/jobs` (`JobProgress`, `JobCompleted`, `JobFailed`, `JobCancelled`)

Protected endpoints require `Authorization: Bearer <access-token>`. Dataset uploads return HTTP 202 with a job and dataset ID; job status is available by API and through owner-scoped SignalR notifications, with polling as a frontend fallback. Imports infer text, integer, decimal, boolean, date, and datetime types from up to 5,000 rows, accepting a typed value when at least 95% of non-empty samples parse. Invalid rows are skipped and recorded with row/column/value/reason details; the import report supports pagination and CSV download. Each dataset uses a GUID-derived `[data].[ds_<id>]` table with generated `[c0]`, `[c1]`, … identifiers, so CSV headers never become SQL identifiers.

Dataset details include a paginated, virtualized preview with server-side sorting and editable column labels. Chart queries support multiple group-by columns, metrics, AND filters, time buckets, sorting, and top-N. The chart editor offers bar, horizontal/stacked bar, line/multi-line, area/stacked area, pie, donut, scatter, KPI, and table presentations; chart previews expose cache status and duration, table output, and CSV/PNG export actions. Dashboards compose charts from different datasets, support layout presets, keyboard move controls, default-board selection, and independently loaded widgets. Saved charts and dashboards are owner-scoped; dashboards use rowversion-backed batch layout updates and return HTTP 409 for stale versions. Query identifiers are derived only from validated dataset column positions and filter values are parameterized.

On upgrade, the `SavedChartsAndDashboards` migration copies existing `SavedReports` into `SavedCharts`, retaining the old rows and API for backward compatibility. The old reports panel is removed from the dataset page.

The queue is in memory: queued/running jobs are marked failed on restart and can be retried while their source file remains available. Failed/cancelled source files are retained for retry; successful imports remove their source file.

## Tests

```powershell
cd D:\DataLens\backend
dotnet test DataLens.slnx

cd D:\DataLens\frontend
npm run lint
npm run test
npm run build
```

Backend integration tests use a unique LocalDB database per fixture. Set `DATALENS_TEST_CONNECTION` to a SQL Server connection string (without a database name) to use another local SQL Server instance.

## Architecture

```mermaid
flowchart LR
    Browser[React workspace] -->|JWT + JSON / multipart| API[ASP.NET Core API]
    API -->|SignalR job events| Browser
    API -->|EF Core| Meta[(SQL Server metadata)]
    API -->|SqlBulkCopy / Dapper| Data[(Dataset tables)]
    API --> Health[SQL Server health check]
```

## Scope and next steps

Some items from the broader product specification remain: previous-period KPI comparisons, dashboard-wide date filters and auto-refresh, PDF export, continuous pointer-based resize/drag on the dashboard grid, completed Exports and Settings workspaces, and Playwright E2E coverage. No benchmark results are claimed until the benchmark has been run.

## Screenshots

Feature screenshots are stored in `docs/screenshots/before/` and `docs/screenshots/after/`. New dashboard, datasets, charts, chart-editor, exports, and settings captures cover 1440px and 390px in both themes. Chart/dashboard screenshots use deterministic mocked API responses; authenticated live-data Playwright E2E is still outstanding. See `AUDIT.md` for the visual findings.
