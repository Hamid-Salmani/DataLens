# DataLens implementation audit

**Audit date:** 2026-11-13  
**Baseline:** Repository sources before implementing the attached feature plan.

## Final visual and regression review

- Captured all five routes/states (landing, sign-in, registration, workspace, and dataset detail) at 1440px and 390px in both themes under `docs/screenshots/after/`; reviewed the final screenshots against the baseline captures.
- The final review caught invalid virtualized-table markup that hid preview cells. Moving the bottom spacer row outside the mapped data rows restored visible values while retaining the virtualized, scrollable table. Mobile workspace entries now stack metadata/actions without overlapping, and auth/detail header links stay on one line.
- Light/dark surfaces, text, controls, type badges, and table striping render consistently in both themes. The wide preview intentionally scrolls horizontally on mobile.
- Frontend build, lint, and all 14 tests pass. Backend suite passes all 7 tests, including the 200-row mixed-quality CSV inference/error-report regression.
- No API contract changed in this UI/type-inference work. This folder has no Git repository, so the requested commits could not be made.

## Current update

- The charts/dashboard implementation was visually captured at both 1440px and 390px in both themes under `docs/screenshots/after/` (`dashboard-*`, `datasets-*`, `charts-*`, `chart-editor-*`, `exports-*`, and `settings-*`). These feature captures use deterministic mocked API responses; the earlier landing/auth/dataset-detail captures remain in the same after folder.
- Reviewing the new dark-dashboard screenshot exposed Recharts SVG labels inheriting invalid raw RGB-channel CSS variable values (black, low-contrast axes). The chart styles now wrap design-token channels in `rgb(...)`; the regenerated dark captures show readable labels, grid, and legend.
- `npm run lint`, `npm run build`, and `npm run test` pass (28 frontend tests), including a chart-editor test that verifies chart-type changes preserve the query settings. The initial JavaScript bundle is now split from route-loaded Recharts/chart work; its largest chunk is below Vite's 500 KB warning threshold.
- Backend tests pass (11), including saved-chart/dashboard API ownership, stale layout version conflict, chart deletion cleanup, migration copying of legacy reports, multi-metric analytics, and the fixture-backed query/injection case. OpenAPI was regenerated to `backend/openapi.json`.
- The screenshot interaction is browser-driven using Playwright with the installed Chrome executable. Authenticated API/data behavior is not covered by the screenshots; live API behavior is covered by the backend integration tests. No Playwright end-to-end create-chart/create-dashboard flow exists yet.
- API contracts are regenerated into `backend/openapi.json`, with corresponding TypeScript paths regenerated into `frontend/src/lib/openapi.generated.ts`.
- The pre-change UI was captured with Playwright/Chrome at 1440px and 390px for both dark and light system preferences under `docs/screenshots/before/`. The captured routes include landing, sign-in, registration, workspace, and dataset detail; the last two used a disposable imported dataset. Visual review found that light preference still rendered the dark-only palette, the default `frontend` document title, inconsistent spacing, small low-contrast labels and controls, cramped mobile analytics controls, and a crowded mobile dataset/table layout. Source inspection also found native selects, a permanent rename input and save button per column, pagination fixed at 100 rows without first/last controls, page/sort state absent from the URL, and a page-level loading branch plus page/sort-dependent table key that unmounted detail content and reset table scroll on pagination.
- CSV type inference, invalid-row diagnostics, the configurable 200 MB upload limit, paginated error reporting, and the 200-row fixture with 7 rejected rows are implemented.
- Upload now returns `202 Accepted`; a bounded in-memory worker queue persists job status, supports owner-scoped status/list/cancel/retry, and reports progress through SignalR with frontend polling fallback. Restarted queued/running jobs become retryable failures.
- Dataset details now include server-side pagination/sorting, a virtualized viewport, and owner-scoped column renaming with duplicate-name validation.
- Disposable LocalDB/API smoke tests completed a 200-row upload (193 imported, 7 skipped), verified the import report, owner-only job access, an authenticated SignalR completion event, cancellation, retry of a 100,000-row file, server sorting, column renaming, invalid-sort rejection, and dataset cleanup.
- Dataset analytics now supports validated grouping, count/sum/average/min/max, typed filters, top-N, private 30-second result caching, and saved-report CRUD/run endpoints. The detail page includes a filter/aggregation builder, bar/table results, and saved-report controls.
- An end-to-end LocalDB smoke test verified grouped filtered aggregates, invalid-column rejection, parameterized text filters, cache headers, saved-report create/list/run/update/delete, and owner isolation.
- Added `sales_with_errors.csv` with 200 rows and six invalid typed cells. Its regression test verifies numeric/date/boolean inference, 194 imported rows, six skipped rows, and exact row/column/raw-value error records.
- Current backend regression suite: 7 tests pass, including the new sales fixture case. Final Playwright screenshots are reviewed; no performance benchmark has been run.
- Remaining work includes durable queue recovery, exports, refresh-token rotation, and broader E2E/accessibility coverage.

## Baseline verification

- `dotnet test backend\DataLens.slnx --nologo --logger "console;verbosity=minimal"`: passed, 4 tests.
- `npm run test -- --reporter=dot` in `frontend`: passed, 4 tests.
- `npm run lint` and `npm run build` in `frontend`: passed.
- The API, Vite app, and Vite `/health` proxy returned HTTP 200 after starting the frontend. The frontend was not listening before it was started; no Playwright or browser-driven feature flow exists.
- There is no `.git` directory in this folder, so the requested per-step git commits cannot be created here.

## Baseline implementation (before the updates above)

- .NET 8 API, SQL Server/LocalDB metadata through EF Core, initial migration, Identity password hashing, JWT access tokens, health check, Swagger, CORS, and per-IP auth/upload rate limits.
- CSV import in the HTTP request using CsvHelper, a 1,000-row type sample, per-dataset SQL tables, generated physical column identifiers, SqlBulkCopy in 10,000-row batches, and basic type conversion.
- Dataset list, detail metadata, paginated preview, delete, dashboard dataset/row totals, and owner scoping for these endpoints.
- React/TypeScript landing, login/register, workspace, CSV upload, dataset list, delete, summary cards, and quick preview.
- Backend tests cover metadata setup and basic typed import/invalid numeric row skipping. Frontend tests cover the dashboard launch route.

## Baseline gaps (historical; see current status above)

### Import validation and error reporting

- Inference requires **every** non-empty sampled value to parse as a type; it has no 95% threshold, integer/decimal distinction, boolean aliases, or date-only type.
- Date-only values are inferred as `datetime`; physical date columns use `datetime2`. Preview formatting is not shared or date-aware.
- The importer skips rows with wrong field counts or failed conversions, but only returns a total skipped count. It does not persist row/column/raw-value/reason errors, and the UI has no paginated import report or errors CSV.
- CsvHelper's bad-data callback is disabled, which can suppress malformed-CSV diagnostics.
- The upload limit is hard-coded at 25 MB in the API/front end; it is not configurable or explicitly aligned with Kestrel and multipart limits.
- The existing importer test uses 1,000 valid numbers plus one invalid number. It does not reproduce the requested 200-row fixture with seven specific invalid rows.

### Jobs and dataset detail

- `ImportJob` exists in the domain and migration, but no service, queue, API, lifecycle processing, cancellation/retry, or progress reporting uses it. Its current enum has no `Running` name or restart handling.
- Imports remain synchronous HTTP requests. There is no bounded channel, `BackgroundService`, SignalR hub/notifier, owner-only job event delivery, or frontend job lifecycle UI.
- Dataset metadata and quick preview exist, but there is no dedicated detail route, rename-columns API, sorting, or virtualized table.

### Analytics, reports, and exports

- Dapper is used for preview queries only. There is no analytics query model, safe query builder, typed filter/group/aggregation validation, comparison, top-N, caching, cache headers, or import-time indexes.
- `SavedReport` exists only as an entity/table; there are no CRUD endpoints or report UI.
- The dashboard is limited to dataset count, imported row total, and latest import. There are no per-dataset KPIs or pinned reports.
- ClosedXML and QuestPDF are referenced but unused. There is no query export, export job, download endpoint, or Export Center.

### Authentication, frontend, and quality

- JWT access tokens expire after 30 minutes. Refresh-token rotation/revocation, refresh single-flight, and comprehensive protected-resource ownership tests are absent.
- The application API is concentrated in `Program.cs`; Application/Domain contain placeholder classes. MediatR, FluentValidation, and Mapster are referenced but not wired into request handling. Serilog is referenced but is not configured as the active logger.
- The UI uses hand-written CSS rather than Tailwind. It does not use React Hook Form/Zod, TanStack Query/Table/Virtual, Zustand, Recharts, or generated OpenAPI types. TypeScript strict mode and `noUncheckedIndexedAccess` are enabled.
- There is one frontend test file and no coverage threshold, component test suite, or Playwright E2E suite. CI collects backend coverage but has no frontend coverage artifact or coverage thresholds.
- The sample generator supports 100k/1M rows, but no benchmark has been run and README contains no measured performance results.
- UI settings/dark-mode persistence, modal/dropdown/tab keyboard patterns, toast system, and the specified broader accessibility interactions are not implemented.

## Main design risks to address

- Row rejection is lossy: the user cannot inspect why a row was skipped.
- A long or interrupted import occupies an HTTP request and has no recoverable job state.
- `Dataset.RowVersion` is configured, but no dataset-versioned query cache exists.
- Saved-report/job ownership cannot be evaluated end-to-end because those features have no API yet.
- This folder is not a git worktree, so commits and branch-based review are unavailable.
