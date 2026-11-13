# DataLens engineering notes

## Current decisions

### Metadata and analytical storage

EF Core 8 with SQL Server stores users, datasets, and inferred schema metadata. Imported rows go into one physical table per dataset, named from a server-generated GUID: `[data].[ds_<guid>]`.

The upload path samples up to 5,000 records and selects `boolean`, `date`, `datetime`, `integer`, or `decimal` when at least 95% of non-empty sample values parse; otherwise it falls back to `text`. It then streams a second CSV pass into `SqlBulkCopy` in 10,000-row batches. Physical column names are generated (`c0`, `c1`, …); CSV headers remain metadata and are never interpolated into SQL. Only the server-generated table name and integer column positions are used to build identifiers. SQL values use parameters.

This design makes dataset deletion straightforward and avoids a single sparse, ever-changing table. The current implementation does not add secondary indexes or a clustered columnstore: the dataset shape and workload need measured query evidence first. Rowstore indexes suit selective filters and point lookups; columnstore suits scan-heavy aggregation but has overhead and is less attractive for small datasets. No benchmark results are claimed yet.

### API, authentication, and ownership

- The API uses minimal endpoints consistently.
- ASP.NET Core Identity hashes passwords; JWT access tokens last 30 minutes.
- Dataset list, detail, preview, summary, and delete queries are scoped to the authenticated owner. Other users' dataset IDs return 404.
- Preview sorting is server-side; requested column names must match the owned dataset schema and are translated to generated physical columns. Column labels can be renamed per dataset and must remain unique.
- Upload accepts `.csv` multipart files up to 200 MB by default. Configure `Uploads:MaxFileSizeBytes` to change the limit. Rows with invalid field counts or values that conflict with inferred types are skipped, persisted with row/column/value/reason diagnostics, and exposed through a paginated report and CSV download.
- Upload returns `202 Accepted` with a persisted import-job ID. A bounded in-memory queue runs configurable workers; owner-scoped list/status/cancel/retry endpoints and owner-targeted SignalR events expose job state. Queued/running work is marked failed on restart; failed/cancelled jobs can be retried while the source file is retained.
- `Uploads:StoragePath` configures the saved source-file directory. Successful jobs remove their source file; deleting a dataset removes source files for its jobs.
- LocalDB connection and a development-only JWT signing key are configured in `appsettings.Development.json`. Set a private `Jwt:SigningKey` for other environments.
- Analytics requests validate column positions and aggregate/type compatibility before generating SQL; physical identifiers use generated `cN` names and filter values are parameterized. Results use a private 30-second cache keyed by dataset row version, column labels, and query.
- Saved charts store validated query and visual-option JSON, are owner-scoped, and support CRUD plus live previews. Queries support multiple group-by columns, metrics, and AND filters. Chart SQL uses validated metadata column positions and parameterized values.
- Existing `SavedReport` rows are copied to `SavedChart` in the `SavedChartsAndDashboards` migration. Legacy rows and endpoints are retained for backward compatibility rather than dropped.
- Dashboards and widgets are owner-scoped. Widget references cannot cross owners. Layouts are submitted in one batch with a rowversion token; stale writes return HTTP 409. Deleting a saved chart explicitly removes its widgets before deleting the chart, avoiding SQL Server multiple-cascade-path issues.
- Chart previews use the existing private analytics cache and return HIT/MISS plus execution duration.
- Chart and dashboard PDF jobs share the export queue and status model with CSV jobs. The worker runs each stored, owner-validated chart query against SQL Server, records section progress, and produces a QuestPDF report with chart metadata, KPI comparison information, and tabular query results. PDF files are stored by export-job ID rather than user-supplied names.
- On startup, unfinished export jobs are marked failed with an explicit restart message rather than remaining queued/running indefinitely. A generated PDF can be requested again by the user; queued/running work is not automatically resumed.
- QuestPDF is configured for the Community license. Commercial deployments must ensure they qualify for that license or switch to an appropriate commercial license.
- Export-job chart/dashboard foreign keys use `NO ACTION` to avoid SQL Server multiple-cascade paths through the owning user. Chart/dashboard deletion explicitly clears export references; completed files remain downloadable until their export job is deleted.
- Export list, status, download, and delete operations are owner-scoped. PDF creation routes verify chart/dashboard ownership before queuing work.
- API contract changes are exported to `backend/openapi.json`, then `npm run api:types` regenerates `frontend/src/lib/openapi.generated.ts`. The generator is isolated from the app's TypeScript compiler because the current generator release only supports TypeScript 5.

### Error and operational behavior

- Validation errors return `ValidationProblemDetails`; upload errors return `ProblemDetails`.
- `/health` checks the configured SQL Server.
- EF migrations are applied automatically only in Development.
- The job queue is process-local, not durable; persisted jobs allow restart reconciliation and retry, but queued work is not automatically re-enqueued.
- Access-token refresh/revocation is not implemented; frontend sign-out clears the local session token.

## Frontend conventions

- The landing CTA routes to `/dashboard`; the dashboard checks API health and requires sign-in.
- The frontend sends JWTs in `Authorization` headers and uses the Vite dev-server proxy for `/api`, `/health`, and `/hubs`.
- Upload state exposes browser upload progress, then SignalR job progress with status polling as a fallback. Completed jobs show imported/skipped row counts and the import-error report.
- Dataset preview uses bounded server-side pagination (maximum 100 rows per request).
- Dataset detail uses server pagination and a virtualized viewport to keep rendered table rows bounded; sorting and column-label changes are reflected in the preview.
- Dataset detail links into the chart editor with the dataset preselected. Chart editor state is serialized in the URL, preview requests are debounced and cancellable, and prior results remain visible during refresh.
- Dashboard widgets fetch previews independently; failed widgets expose their own retry action. The responsive CSS grid supports move-up/down alternatives and size presets in edit mode.
- Dashboard layouts use `react-grid-layout` v2 with responsive 12/8/4/1-column breakpoints, header-only drag, south/east/southeast resize handles, dashed drag placeholders, debounced layout saves, and a reload path on optimistic-concurrency conflicts. Widget menu actions provide keyboard move and size alternatives.
- Recharts is route-loaded with the chart and dashboard workspace chunks rather than included in the initial landing-page bundle.

## Tradeoffs and remaining limitations

- PDF files contain actual query results and comparison values, but do not yet embed a rendered graphical chart; the tables remain the accessible data representation.
- The final screenshot capture is a real Development API/LocalDB Playwright run covering public routes and all authenticated routes at 1440px/390px in both themes. Generated files live in `docs/screenshots/final/`.
- The Playwright suite exercises real UI import, chart creation, dashboard persistence, PDF download, responsive layout drag/resize, exports, and settings. The live workflow creates and removes its dedicated test account; grid/date/export test workspaces use the live Development database.
- Backend coverage was measured with Coverlet/Cobertura: 78.25% line coverage (6,866/8,774) and 54.86% branch coverage (637/1,161) across instrumented assemblies.
- Refresh-token rotation and durable job storage remain out of scope; import jobs still use the in-memory worker queue.
