import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { HubConnectionBuilder } from '@microsoft/signalr'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { Select, type SelectOption } from './components/Select'
import { ThemeProvider, ThemeToggle } from './theme'
import { AppLayout, PageContainer, PageHeader } from './components/AppLayout'
import 'react-grid-layout/css/styles.css'
import {
  api,
  apiBaseUrl,
  checkApiHealth,
  downloadImportErrorsCsv,
  MAX_CSV_UPLOAD_BYTES,
  type DashboardSummary,
  type Dataset,
  type DatasetPreview,
  type AuthResponse,
  type ImportErrorPage,
  type ImportJobStatus,
} from './lib/api'
import { formatDatasetValue } from './lib/formatters'

const ChartEditorPage = lazy(() => import('./features/charts/ChartPages').then(module => ({ default: module.ChartEditorPage })))
const ChartLibraryPage = lazy(() => import('./features/charts/ChartPages').then(module => ({ default: module.ChartLibraryPage })))
const DashboardHomePage = lazy(() => import('./features/dashboard/DashboardHomePage').then(module => ({ default: module.DashboardHomePage })))
const ExportsPage = lazy(() => import('./features/account/AccountPages').then(module => ({ default: module.ExportsPage })))
const SettingsPage = lazy(() => import('./features/account/AccountPages').then(module => ({ default: module.SettingsPage })))

function App() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<main className="p-8 text-center text-muted" role="status">Loading workspace…</main>}>
            <Routes>
              <Route path="/welcome" element={<LandingPage />} />
              <Route path="/auth" element={<AuthRoute />} />
              <Route path="/" element={<HomeRoute />} />
              <Route element={<AppLayout />}>
                <Route path="/datasets" element={<DashboardPage />} />
                <Route path="/dashboard" element={<Navigate to="/" replace />} />
                <Route path="/charts" element={<ChartLibraryPage />} />
                <Route path="/charts/new" element={<ChartEditorPage />} />
                <Route path="/charts/:chartId/edit" element={<ChartEditorPage />} />
                <Route path="/exports" element={<ExportsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/datasets/:id" element={<DatasetDetailPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

function HomeRoute() {
  return sessionStorage.getItem('datalens.accessToken')
    ? <AppLayout><DashboardHomePage /></AppLayout>
    : <LandingPage />
}

function AuthRoute() {
  return sessionStorage.getItem('datalens.accessToken')
    ? <Navigate to="/datasets" replace />
    : <DashboardPage />
}

function Brand() {
  return (
    <Link className="inline-flex shrink-0 items-center gap-2.5 text-lg font-bold text-foreground no-underline" to="/" aria-label="DataLens home">
      <span className="grid size-[30px] place-items-center rounded-lg bg-primary text-background">D</span>
      <span>DataLens</span>
    </Link>
  )
}

function LandingPage() {
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void checkApiHealth().then((healthy) => {
      if (active) setApiOnline(healthy)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="mx-auto w-[calc(100%-2rem)] max-w-[1200px] py-6 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/75 py-2 pb-5">
        <Brand />
        <nav className="order-3 flex w-full flex-wrap gap-4 sm:order-none sm:w-auto" aria-label="Main navigation">
          <a className="font-semibold text-primary no-underline" href="#features">Platform</a>
          <a className="font-semibold text-primary no-underline" href="#features">Features</a>
          <a className="font-semibold text-primary no-underline" href="#architecture">Architecture</a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeToggle />
          <Link className="font-semibold text-primary no-underline" to="/auth">Open workspace</Link>
        </div>
      </header>

      <section className="grid items-center gap-8 py-9 md:grid-cols-[1.2fr_0.8fr] md:py-14">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">CSV analytics workspace</p>
          <h1 className="m-0 text-4xl font-bold leading-none tracking-[-0.055em] text-foreground sm:text-6xl">Make your data easier to see.</h1>
          <p className="mt-[18px] max-w-[620px] text-[1.05rem] text-muted">
            Import a CSV, inspect its schema, and explore your dataset in a clean,
            SQL Server-backed workspace.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-3.5 py-2.5 font-semibold text-background no-underline hover:brightness-110" to="/auth">Launch dashboard</Link>
            <a className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 font-semibold text-foreground no-underline hover:brightness-105" href="#architecture">View architecture</a>
          </div>
          <p className="mt-5 flex items-center gap-2 text-sm text-muted" role="status">
            <span className={`size-[9px] rounded-full ${apiOnline ? 'bg-success' : apiOnline === false ? 'bg-danger' : 'bg-warning'}`} />
            {apiOnline === null ? 'Checking API…' : apiOnline ? 'API connected' : 'API unavailable — start the backend'}
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-surface" aria-label="Workspace preview">
          <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-4 py-3">
            <span className="size-[9px] rounded-full bg-danger" />
            <span className="size-[9px] rounded-full bg-warning" />
            <span className="size-[9px] rounded-full bg-success" />
            <span className="ml-auto text-xs text-muted">Workspace preview</span>
          </div>
          <div className="p-[18px]">
            <div className="text-xs font-semibold text-primary">YOUR DATA, READY TO EXPLORE</div>
            <div className="grid min-h-[150px] place-content-center justify-items-center gap-2 text-center text-muted">
              <span className="grid size-11 place-items-center rounded-xl border border-primary/40 bg-primary/10 text-xl font-bold text-primary" aria-hidden="true">↑</span>
              <strong className="text-foreground">Start with a CSV file</strong>
              <span className="max-w-[290px] text-sm">Upload it in your workspace to see real dataset details here.</span>
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-3 border-t border-border pt-3 text-xs text-muted">
              <span>SQL Server storage</span>
              <span>Private to your account</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2" id="features">
        <article className="rounded-xl border border-border bg-surface p-4">
          <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Import</span>
          <p className="mt-2.5 text-muted">Stream CSV rows into a dataset table without loading the entire file into memory.</p>
        </article>
        <article className="rounded-xl border border-border bg-surface p-4">
          <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Inspect</span>
          <p className="mt-2.5 text-muted">Review inferred column types and page through imported rows in the workspace.</p>
        </article>
        <article className="rounded-xl border border-border bg-surface p-4">
          <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Control</span>
          <p className="mt-2.5 text-muted">Sign in with a personal account; dataset access is scoped to its owner.</p>
        </article>
        <article className="rounded-xl border border-border bg-surface p-4">
          <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Built to extend</span>
          <p className="mt-2.5 text-muted">Use a .NET API, EF Core metadata, and dataset-specific SQL Server tables.</p>
        </article>
      </section>

      <section className="mt-7 grid gap-6 rounded-xl border border-border bg-surface p-5 md:grid-cols-[0.8fr_1.2fr]" id="architecture">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">Architecture</p>
          <h2 className="m-0 text-2xl font-semibold text-foreground">A focused, working foundation</h2>
        </div>
        <ul className="m-0 grid gap-2 pl-5 text-muted">
          <li>.NET 8 API + EF Core + SQL Server LocalDB</li>
          <li>JWT authentication and per-user dataset ownership</li>
          <li>Streaming CSV parser + SqlBulkCopy</li>
          <li>React + TypeScript frontend connected through the Vite API proxy</li>
        </ul>
      </section>
    </main>
  )
}

function DashboardPage() {
  const navigate = useNavigate()
  const [token, setToken] = useState(() => sessionStorage.getItem('datalens.accessToken'))
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem('datalens.accessToken')))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    sessionStorage.setItem('datalens.accessToken', token)
    let active = true
    void Promise.all([
      api.get<Dataset[]>('/datasets'),
      api.get<DashboardSummary>('/dashboard/summary'),
    ])
      .then(([currentDatasets, currentSummary]) => {
        if (!active) return
        setDatasets(currentDatasets)
        setSummary(currentSummary)
        setError('')
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof Error && 'status' in cause && cause.status === 401) {
          sessionStorage.removeItem('datalens.accessToken')
          setToken(null)
          setError('Your session expired. Please sign in again.')
          return
        }
        setError(cause instanceof Error ? cause.message : 'Could not load the workspace.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  const handleAuthenticated = (response: AuthResponse) => {
    sessionStorage.setItem('datalens.accessToken', response.accessToken)
    setLoading(true)
    setToken(response.accessToken)
    setError('')
    navigate('/datasets', { replace: true })
  }

  const refreshWorkspace = async () => {
    const [currentDatasets, currentSummary] = await Promise.all([
      api.get<Dataset[]>('/datasets'),
      api.get<DashboardSummary>('/dashboard/summary'),
    ])
    setDatasets(currentDatasets)
    setSummary(currentSummary)
  }

  const deleteDataset = async (dataset: Dataset) => {
    if (!window.confirm(`Delete "${dataset.name}" and its imported rows?`)) return
    try {
      await api.delete(`/datasets/${dataset.id}`)
      await refreshWorkspace()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the dataset.')
    }
  }

  if (!token) {
    return (
      <PageContainer>
        <header className="flex flex-nowrap items-center justify-between gap-2 border-b border-border/75 py-2 pb-5 sm:gap-4"><Brand /><div className="flex shrink-0 items-center gap-2 sm:gap-4"><ThemeToggle /><Link className="whitespace-nowrap text-sm font-semibold text-primary no-underline sm:text-base" to="/">Back to home</Link></div></header>
        <AuthPanel onAuthenticated={handleAuthenticated} message={error} />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader eyebrow="Your private workspace" title="Datasets" description="Upload and inspect CSV datasets stored in your SQL Server database." actions={<UploadPanel onUploaded={refreshWorkspace} onError={setError} />} />

      {error && <div className="my-3 rounded-lg border border-danger/50 bg-danger/10 px-3.5 py-3 text-danger" role="alert">{error}</div>}

      <section className="my-4 mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3" aria-label="Dataset summary">
        <MetricCard label="Datasets" value={loading ? '—' : String(summary?.datasetCount ?? 0)} />
        <MetricCard label="Imported rows" value={loading ? '—' : (summary?.totalRows ?? 0).toLocaleString()} />
        <MetricCard label="Latest import" value={summary?.latestDataset ? new Date(summary.latestDataset.createdAt).toLocaleDateString() : '—'} />
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="m-0 text-xl font-semibold text-foreground">Your datasets</h2>
            <p className="mt-1 text-sm text-muted">Only datasets created by your account appear here.</p>
          </div>
          <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{datasets.length} total</span>
        </div>
        {loading ? (
          <div className="grid min-h-[120px] place-content-center justify-items-center gap-2 text-center text-muted">Loading your workspace…</div>
        ) : datasets.length === 0 ? (
          <div className="grid min-h-[120px] place-content-center justify-items-center gap-2 text-center text-muted">
            <strong className="text-foreground">No datasets yet</strong>
            <span>Choose a CSV above to create your first dataset.</span>
          </div>
        ) : (
          <div className="grid">
            {datasets.map((dataset) => (
              <article className="grid min-h-[68px] grid-cols-[42px_minmax(0,1fr)] items-center gap-3 border-t border-border py-3 first:border-t-0 sm:flex sm:justify-between" key={dataset.id}>
                <div className="grid size-[42px] shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-bold text-primary" aria-hidden="true">CSV</div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{dataset.name}</strong>
                  <span className="break-words text-xs text-muted">
                    {dataset.fileName} · {dataset.columnCount ?? 0} columns · {dataset.rowCount.toLocaleString()} rows
                    {dataset.skippedRows > 0 ? ` · ${dataset.skippedRows.toLocaleString()} skipped` : ''}
                  </span>
                </div>
                <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto">
                  <span className="mr-auto whitespace-nowrap text-xs text-muted sm:mr-2">{new Date(dataset.createdAt).toLocaleDateString()}</span>
                  <Link className="inline-flex min-h-9 items-center whitespace-nowrap rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground no-underline hover:brightness-105" to={`/datasets/${dataset.id}`}>Open dataset</Link>
                  <button className="inline-flex min-h-9 items-center whitespace-nowrap rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-danger hover:brightness-105" type="button" onClick={() => void deleteDataset(dataset)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

    </PageContainer>
  )
}

function DatasetDetailPage() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const hasToken = Boolean(sessionStorage.getItem('datalens.accessToken'))
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = [25, 50, 100].includes(Number(searchParams.get('pageSize')))
    ? Number(searchParams.get('pageSize'))
    : 50
  const sortBy = searchParams.get('sortBy')
  const sortDirection = searchParams.get('sortDirection') === 'desc' ? 'desc' : 'asc'
  const [editingPosition, setEditingPosition] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [savingPosition, setSavingPosition] = useState<number | null>(null)
  const [error, setError] = useState('')
  const datasetQuery = useQuery({
    queryKey: ['dataset', id],
    queryFn: () => api.get<Dataset>(`/datasets/${id}`),
    enabled: Boolean(id && hasToken),
  })
  const previewQuery = useQuery({
    queryKey: ['dataset-preview', id, page, pageSize, sortBy, sortDirection],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (sortBy) {
        params.set('sortBy', sortBy)
        params.set('sortDirection', sortDirection)
      }
      return api.get<DatasetPreview>(`/datasets/${id}/preview?${params}`)
    },
    enabled: Boolean(id && hasToken),
    placeholderData: (previousData) => previousData,
  })
  const dataset = datasetQuery.data ?? null
  const preview = previewQuery.data ?? null

  useEffect(() => {
    if (searchParams.has('page') && searchParams.has('pageSize')) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (!next.has('page')) next.set('page', '1')
      if (!next.has('pageSize')) next.set('pageSize', '50')
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams])

  if (!id || !hasToken) return <Navigate to="/datasets" replace />

  const saveColumnName = async (position: number, currentName: string) => {
    const name = renameValue.trim()
    if (!name || name === currentName) {
      setEditingPosition(null)
      return
    }
    setSavingPosition(position)
    setError('')
    try {
      await api.put(`/datasets/${id}/columns/${position}`, { name })
      setEditingPosition(null)
      await queryClient.invalidateQueries({ queryKey: ['dataset', id] })
      await queryClient.invalidateQueries({ queryKey: ['dataset-preview', id] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename this column.')
    } finally {
      setSavingPosition(null)
    }
  }

  const changeSort = (columnName: string) => {
    const nextDirection = sortBy === columnName && sortDirection === 'asc' ? 'desc' : 'asc'
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('sortBy', columnName)
      next.set('sortDirection', nextDirection)
      next.set('page', '1')
      return next
    })
  }

  const updatePreviewParams = (nextValues: { page?: number; pageSize?: number }) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (nextValues.page !== undefined) next.set('page', String(nextValues.page))
      if (nextValues.pageSize !== undefined) {
        next.set('pageSize', String(nextValues.pageSize))
        next.set('page', '1')
      }
      return next
    })
  }
  const columns = dataset?.columns ?? []
  const pageCount = preview ? Math.ceil(preview.totalRows / pageSize) : 0

  return (
    <PageContainer>
    {(error || datasetQuery.error || previewQuery.error) && <div className="my-3 rounded-lg border border-danger/50 bg-danger/10 px-3.5 py-3 text-danger" role="alert">
        {error || (datasetQuery.error instanceof Error ? datasetQuery.error.message : previewQuery.error instanceof Error ? previewQuery.error.message : '')}
      </div>}
      {!dataset ? (
        datasetQuery.isError ? (
          <div className="grid min-h-[120px] place-content-center justify-items-center gap-2 text-center text-muted" role="status">
            <strong>Could not load this dataset.</strong>
            <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground hover:brightness-105" type="button" onClick={() => void datasetQuery.refetch()}>Try again</button>
          </div>
        ) : <div className="grid min-h-[120px] place-content-center justify-items-center gap-2 text-center text-muted">Loading dataset…</div>
      ) : (
        <>
          <PageHeader eyebrow="Dataset details" title={dataset.name} description={`${dataset.fileName} · created ${new Date(dataset.createdAt).toLocaleDateString()}`}
            actions={<>
            <div className="flex flex-wrap gap-2.5 text-xs text-muted">
              <span className="inline-flex gap-1 rounded-lg border border-border bg-surface px-3 py-2"><strong className="text-foreground">{dataset.rowCount.toLocaleString()}</strong> rows</span>
              <span className="inline-flex gap-1 rounded-lg border border-border bg-surface px-3 py-2"><strong className="text-foreground">{columns.length}</strong> columns</span>
              {dataset.skippedRows > 0 && <span className="inline-flex gap-1 rounded-lg border border-border bg-surface px-3 py-2"><strong className="text-foreground">{dataset.skippedRows.toLocaleString()}</strong> skipped</span>}
            </div>
            <Link className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground no-underline" to="/datasets">All datasets</Link>
            </>} />

          <section className="mt-4 rounded-xl border border-border bg-surface p-5" aria-labelledby="schema-heading">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="m-0 text-xl font-semibold text-foreground" id="schema-heading">Columns</h2>
                <p className="mt-1 text-sm text-muted">Rename a column to update its label across dataset views.</p>
              </div>
            </div>
            <div className="grid">
              {columns.map((column) => (
                <div className="grid min-h-12 grid-cols-[minmax(110px,160px)_minmax(120px,1fr)_auto] items-center gap-3 border-t border-border py-1.5 first:border-t-0 max-sm:grid-cols-[minmax(80px,1fr)_auto]" key={column.position} onKeyDown={(event) => {
                  if (event.key === 'Escape' && editingPosition === column.position) {
                    setEditingPosition(null)
                    setRenameValue('')
                  }
                }}>
                  <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
                    columnTypeCategory(column.typeName) === 'number' ? 'bg-chart-1/10 text-chart-1'
                      : columnTypeCategory(column.typeName) === 'text' ? 'bg-chart-4/10 text-chart-4'
                        : columnTypeCategory(column.typeName) === 'date' ? 'bg-chart-7/10 text-chart-7'
                          : 'bg-chart-2/10 text-chart-2'
                  }`}>
                    <span aria-hidden="true">{columnTypeIcon(column.typeName)}</span> {column.typeName}
                  </span>
                  {editingPosition === column.position ? (
                    <form className="col-span-2 flex items-center gap-2 max-sm:col-span-2 max-sm:row-start-2" onSubmit={(event) => {
                  event.preventDefault()
                  void saveColumnName(column.position, column.name)
                }}>
                    <label className="sr-only" htmlFor={`column-${column.position}`}>Column {column.position + 1} name</label>
                    <input
                      className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                      id={`column-${column.position}`}
                      autoFocus
                      value={renameValue}
                      maxLength={200}
                      onChange={(event) => setRenameValue(event.target.value)}
                    />
                    <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={savingPosition === column.position || !renameValue.trim()}>
                      {savingPosition === column.position ? 'Saving…' : 'Save'}
                    </button>
                    <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground hover:brightness-105" type="button" onClick={() => setEditingPosition(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="min-h-[34px] justify-start rounded-lg bg-transparent px-2 py-1 text-left font-semibold text-foreground hover:bg-surface-raised"
                        type="button"
                        aria-label={`Rename ${column.name}`}
                        onClick={() => { setEditingPosition(column.position); setRenameValue(column.name) }}
                      >
                        {column.name}
                      </button>
                      <span className="text-right text-xs text-muted max-sm:col-span-2 max-sm:text-left">Enter to save · Esc to cancel</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-border bg-surface p-5" aria-labelledby="data-heading">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="m-0 text-xl font-semibold text-foreground" id="data-heading">Data preview</h2>
                <p className="mt-1 text-sm text-muted">{preview ? `${preview.totalRows.toLocaleString()} rows · sorted server-side` : 'Loading row preview…'}</p>
              </div>
            </div>
            {previewQuery.isFetching && (
              <div className="h-0.5 overflow-hidden bg-border" role="status" aria-label="Updating data preview">
                <span className="block h-full w-[35%] animate-preview-progress bg-primary motion-reduce:animate-none" />
              </div>
            )}
            {!preview ? (
              previewQuery.isError ? (
                <div className="grid min-h-[120px] place-content-center justify-items-center gap-2 text-center text-muted" role="status">
                  <strong>Could not load the data preview.</strong>
                  <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground hover:brightness-105" type="button" onClick={() => void previewQuery.refetch()}>Try again</button>
                </div>
              ) : <div className="grid min-h-[120px] place-content-center justify-items-center gap-2 text-center text-muted">Loading data preview…</div>
            ) : preview.rows.length === 0 ? (
              <div className="grid min-h-[120px] place-content-center justify-items-center gap-2 text-center text-muted">This dataset has no rows to display.</div>
            ) : (
              <VirtualizedDatasetTable
                datasetId={dataset.id}
                columns={columns}
                rows={preview.rows}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={changeSort}
                page={page}
                pageCount={pageCount}
                pageSize={pageSize}
                totalRows={preview.totalRows}
                loading={previewQuery.isFetching}
                onPageChange={(nextPage) => updatePreviewParams({ page: nextPage })}
                onPageSizeChange={(nextSize) => updatePreviewParams({ pageSize: nextSize })}
              />
            )}
          </section>

          <section className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5">
            <div><h2 className="m-0 text-xl font-semibold text-foreground">Charts</h2><p className="mt-1 text-sm text-muted">Build a reusable chart from this dataset and add it to any dashboard.</p></div>
            <Link className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 py-2.5 font-semibold text-background no-underline" to={`/charts/new?dataset=${dataset.id}`}>Create chart from this dataset</Link>
          </section>
        </>
      )}
    </PageContainer>
  )
}

function VirtualizedDatasetTable({
  datasetId,
  columns,
  rows,
  sortBy,
  sortDirection,
  onSort,
  page,
  pageCount,
  pageSize,
  totalRows,
  loading,
  onPageChange,
  onPageSizeChange,
}: {
  datasetId: string
  columns: NonNullable<Dataset['columns']>
  rows: DatasetPreview['rows']
  sortBy: string | null
  sortDirection: 'asc' | 'desc'
  onSort: (columnName: string) => void
  page: number
  pageCount: number
  pageSize: number
  totalRows: number
  loading: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tableColumns = useMemo(() => columns.map((column) => ({
    id: String(column.position),
    accessorFn: (row: DatasetPreview['rows'][number]) => row[column.name],
  })), [columns])
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  })
  const tableRows = table.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
    overscan: 8,
    initialRect: { width: 800, height: 440 },
  })
  const measuredItems = virtualizer.getVirtualItems().map((item) => ({
    index: item.index,
    start: item.start,
    size: item.size,
  }))
  const virtualRows = measuredItems.length > 0
    ? measuredItems
    : tableRows.slice(0, 20).map((_, index) => ({ index, start: index * 42, size: 42 }))
  const firstVirtualRow = virtualRows[0]
  const lastVirtualRow = virtualRows[virtualRows.length - 1]
  const topSpacerHeight = firstVirtualRow?.start ?? 0
  const bottomSpacerHeight = lastVirtualRow
    ? Math.max(0, virtualizer.getTotalSize() - (lastVirtualRow.start + lastVirtualRow.size))
    : 0
  const firstResult = totalRows === 0 ? 0 : (page - 1) * pageSize + 1
  const lastResult = Math.min(page * pageSize, totalRows)

  return (
    <div className="relative" aria-busy={loading}>
      <div data-testid="preview-scroll" className={`relative h-[440px] max-h-[440px] overflow-auto rounded-lg border border-border transition-opacity ${loading ? 'opacity-75' : ''}`} ref={scrollRef}>
        <table className="w-max min-w-full table-fixed border-separate border-spacing-0 text-left text-xs">
        <colgroup>{columns.map((column) => <col className="w-40" key={column.position} />)}</colgroup>
        <thead>
          <tr>{columns.map((column) => (
            <th
              className="sticky top-0 z-[2] whitespace-normal bg-surface-raised px-3 py-2.5 text-left text-foreground"
              key={column.position}
              scope="col"
              aria-sort={sortBy === column.name ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <button className="min-h-0 border-0 bg-transparent p-0 text-left font-bold text-foreground" type="button" onClick={() => onSort(column.name)} aria-label={`Sort by ${column.name}`}>
                {column.name}
                <span className="mt-1 flex items-center gap-1 text-[0.69rem] font-normal text-muted">
                  {column.typeName}
                  <span className="text-primary" aria-hidden="true">
                    {sortBy === column.name ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                  </span>
                </span>
              </button>
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {topSpacerHeight > 0 && (
            <tr aria-hidden="true">
              <td className="border-0 p-0" colSpan={columns.length} style={{ height: topSpacerHeight }} />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = tableRows[virtualRow.index]
            if (!row) return null
            return (
              <tr
                className={`h-[42px] ${
                  virtualRow.index % 2 === 0 ? 'bg-surface' : 'bg-surface-raised/55'
                } hover:bg-primary/10`}
                key={`${datasetId}-${(page - 1) * pageSize + virtualRow.index}`}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
              >
                {columns.map((column) => {
                  const value = row.original[column.name]
                  const numeric = ['integer', 'decimal', 'number'].includes(column.typeName)
                  const isNull = value === null || value === undefined
                  const isBoolean = column.typeName === 'boolean' || typeof value === 'boolean'
                  return (
                    <td className={`h-[42px] max-w-[280px] overflow-hidden border-b border-border/70 px-3 py-2.5 text-foreground ${numeric ? 'text-right [font-variant-numeric:tabular-nums]' : 'text-left'}`} key={column.position}>
                      {isNull ? <span className="text-muted">—</span> : isBoolean
                        ? <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.72rem] ${value === true || value === 'true' ? 'bg-success/10 text-success' : 'bg-border/50 text-muted'}`}>{formatDatasetValue(value, column.typeName)}</span>
                        : <span className="block overflow-hidden text-ellipsis" title={String(value)}>{formatDatasetValue(value, column.typeName)}</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          {bottomSpacerHeight > 0 && (
            <tr aria-hidden="true">
              <td className="border-0 p-0" colSpan={columns.length} style={{ height: bottomSpacerHeight }} />
            </tr>
          )}
        </tbody>
        </table>
      </div>
      <div className="flex flex-col justify-between gap-3 pt-3 text-xs text-muted sm:flex-row sm:items-center">
        <span>Showing {firstResult.toLocaleString()}–{lastResult.toLocaleString()} of {totalRows.toLocaleString()}</span>
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          <label className="flex items-center gap-1.5">Rows
            <Select
              label="Rows per page"
              value={String(pageSize)}
              options={[25, 50, 100].map((size): SelectOption => ({ value: String(size), label: String(size) }))}
              onChange={(size) => onPageSizeChange(Number(size))}
            />
          </label>
          <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 font-semibold text-foreground hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label="First page" disabled={page <= 1} onClick={() => onPageChange(1)}>«</button>
          <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 font-semibold text-foreground hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹</button>
          <span className="whitespace-nowrap px-1">Page {page} of {Math.max(pageCount, 1)}</span>
          <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 font-semibold text-foreground hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label="Next page" disabled={pageCount === 0 || page >= pageCount} onClick={() => onPageChange(page + 1)}>›</button>
          <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 font-semibold text-foreground hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label="Last page" disabled={pageCount === 0 || page >= pageCount} onClick={() => onPageChange(pageCount)}>»</button>
        </div>
      </div>
    </div>
  )
}

function columnTypeCategory(typeName: NonNullable<Dataset['columns']>[number]['typeName']): string {
  if (typeName === 'integer' || typeName === 'decimal' || typeName === 'number') return 'number'
  if (typeName === 'date' || typeName === 'datetime') return 'date'
  if (typeName === 'boolean') return 'boolean'
  return 'text'
}

function columnTypeIcon(typeName: NonNullable<Dataset['columns']>[number]['typeName']): string {
  const category = columnTypeCategory(typeName)
  return category === 'number' ? '#' : category === 'date' ? '◷' : category === 'boolean' ? '◉' : 'T'
}

function AuthPanel({ onAuthenticated, message }: { onAuthenticated: (response: AuthResponse) => void; message: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'email' | 'password' | 'confirmPassword' | 'firstName' | 'lastName', string>>>({})
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  const validateFields = () => {
    const errors: typeof fieldErrors = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Enter a valid email address, like name@example.com.'
    }
    if (!password) {
      errors.password = 'Enter your password.'
    } else if (mode === 'register') {
      if (password.length < 10) errors.password = 'Use at least 10 characters.'
      else if (!/[A-Z]/.test(password)) errors.password = 'Add at least one uppercase letter.'
      else if (!/[a-z]/.test(password)) errors.password = 'Add at least one lowercase letter.'
      else if (!/[0-9]/.test(password)) errors.password = 'Add at least one number.'
      else if (!/[^A-Za-z0-9]/.test(password)) errors.password = 'Add at least one symbol.'
    }
    if (mode === 'register') {
      if (!firstName.trim()) errors.firstName = 'Enter your first name.'
      if (!lastName.trim()) errors.lastName = 'Enter your last name.'
      if (confirmPassword !== password) errors.confirmPassword = 'Your passwords do not match.'
    }
    return errors
  }

  const validateField = (field: keyof typeof fieldErrors) => {
    const errors = validateFields()
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
  }

  const clearFieldError = (field: keyof typeof fieldErrors) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const errors = validateFields()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setBusy(true)
    try {
      const response = mode === 'login'
        ? await api.post<AuthResponse>('/auth/login', { email, password })
        : await api.post<AuthResponse>('/auth/register', { email, password, firstName, lastName })
      onAuthenticated(response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto my-9 w-full max-w-[520px] rounded-xl border border-border bg-surface p-5 sm:my-[60px] sm:p-7">
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">{mode === 'login' ? 'Welcome back' : 'Create your account'}</p>
      <h1 className="m-0 text-3xl font-bold leading-tight tracking-tight text-foreground">{mode === 'login' ? 'Sign in to DataLens' : 'Start exploring your data'}</h1>
      <p className="mb-5 mt-2 text-muted">Your datasets are private to your account.</p>
      {(error || message) && (
        <div className="my-3 flex gap-2.5 rounded-lg border border-danger/50 bg-danger/10 px-3.5 py-3 leading-relaxed text-danger" role="alert">
          <span className="grid size-5 shrink-0 place-items-center rounded-full border border-danger font-bold" aria-hidden="true">!</span>
          <span>{error || message}</span>
        </div>
      )}
      <form className="grid gap-3.5" noValidate onSubmit={(event) => void submit(event)}>
        {mode === 'register' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-left text-xs font-semibold text-muted">
              First name
              <input className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25" 
                value={firstName}
                onChange={(event) => { setFirstName(event.target.value); clearFieldError('firstName') }}
                onBlur={() => validateField('firstName')}
                autoComplete="given-name"
                aria-invalid={Boolean(fieldErrors.firstName)}
                aria-describedby={fieldErrors.firstName ? 'first-name-error' : undefined}
                required
              />
              {fieldErrors.firstName && <span className="text-sm leading-snug text-danger" id="first-name-error">{fieldErrors.firstName}</span>}
            </label>
            <label className="grid gap-1.5 text-left text-xs font-semibold text-muted">
              Last name
              <input className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={lastName}
                onChange={(event) => { setLastName(event.target.value); clearFieldError('lastName') }}
                onBlur={() => validateField('lastName')}
                autoComplete="family-name"
                aria-invalid={Boolean(fieldErrors.lastName)}
                aria-describedby={fieldErrors.lastName ? 'last-name-error' : undefined}
                required
              />
              {fieldErrors.lastName && <span className="text-sm leading-snug text-danger" id="last-name-error">{fieldErrors.lastName}</span>}
            </label>
          </div>
        )}
        <label className="grid gap-1.5 text-left text-xs font-semibold text-muted">
          Email
          <input className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            type="email"
            value={email}
            onChange={(event) => { setEmail(event.target.value); clearFieldError('email') }}
            onBlur={() => validateField('email')}
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            required
          />
          {fieldErrors.email && <span className="text-sm leading-snug text-danger" id="email-error">{fieldErrors.email}</span>}
        </label>
        <label className="grid gap-1.5 text-left text-xs font-semibold text-muted">
          Password
          <input className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            type="password"
            value={password}
            onChange={(event) => { setPassword(event.target.value); clearFieldError('password'); clearFieldError('confirmPassword') }}
            onBlur={() => validateField('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'password-error' : mode === 'register' ? 'password-hint' : undefined}
            required
          />
          {fieldErrors.password && <span className="text-sm leading-snug text-danger" id="password-error">{fieldErrors.password}</span>}
        </label>
        {mode === 'register' && (
          <>
            <p className="text-xs text-muted" id="password-hint">At least 10 characters, including upper/lowercase, a number, and a symbol.</p>
            <label className="grid gap-1.5 text-left text-xs font-semibold text-muted">
              Confirm password
              <input className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                type="password"
                value={confirmPassword}
                onChange={(event) => { setConfirmPassword(event.target.value); clearFieldError('confirmPassword') }}
                onBlur={() => validateField('confirmPassword')}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                aria-describedby={fieldErrors.confirmPassword ? 'confirm-password-error' : undefined}
                required
              />
              {fieldErrors.confirmPassword && <span className="text-sm leading-snug text-danger" id="confirm-password-error">{fieldErrors.confirmPassword}</span>}
            </label>
          </>
        )}
        <button className="mt-1 inline-flex min-h-10 items-center justify-center rounded-lg border border-transparent bg-primary px-3.5 py-2.5 font-semibold text-background hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="mt-4 text-sm text-muted">
        {mode === 'login' ? 'New to DataLens?' : 'Already registered?'}{' '}
        <button className="min-h-8 rounded px-1 text-primary hover:bg-surface-raised" type="button" onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login')
          setError('')
          setFieldErrors({})
          setConfirmPassword('')
        }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button>
      </p>
    </section>
  )
}

function UploadPanel({ onUploaded, onError }: { onUploaded: () => Promise<void>; onError: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState('')
  const [fileError, setFileError] = useState('')
  const [reportDataset, setReportDataset] = useState<{ id: string; name: string; skippedRows: number } | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [activeJob, setActiveJob] = useState<ImportJobStatus | null>(null)
  const [jobActionBusy, setJobActionBusy] = useState(false)
  const [jobStatusError, setJobStatusError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const completedJobId = useRef<string | null>(null)
  const activeJobId = activeJob?.jobId
  const activeJobStatus = activeJob?.status

  useEffect(() => {
    if (!activeJobId || (activeJobStatus !== 'Queued' && activeJobStatus !== 'Running')) return

    let active = true
    const updateJob = (job: ImportJobStatus) => {
      if (active && job.jobId === activeJobId) setActiveJob(job)
    }
    const connection = new HubConnectionBuilder()
      .withUrl(new URL('/hubs/jobs', new URL(apiBaseUrl, window.location.origin)).toString(), {
        accessTokenFactory: () => sessionStorage.getItem('datalens.accessToken') ?? '',
      })
      .withAutomaticReconnect()
      .build()

    connection.on('JobProgress', updateJob)
    connection.on('JobCompleted', updateJob)
    connection.on('JobFailed', updateJob)
    connection.on('JobCancelled', updateJob)
    void connection.start().catch(() => {
      // Status polling remains active when SignalR is unavailable.
    })

    const refreshStatus = async () => {
      try {
        updateJob(await api.get<ImportJobStatus>(`/import-jobs/${activeJobId}`))
        if (active) setJobStatusError('')
      } catch (cause) {
        if (active) setJobStatusError(cause instanceof Error ? cause.message : 'Could not refresh import status.')
      }
    }
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 1_500)

    return () => {
      active = false
      window.clearInterval(timer)
      void connection.stop()
    }
  }, [activeJobId, activeJobStatus])

  useEffect(() => {
    if (!activeJob || activeJob.status !== 'Completed' || completedJobId.current === activeJob.jobId) return
    completedJobId.current = activeJob.jobId
    setSuccess(`Imported ${activeJob.rowsProcessed.toLocaleString()} rows${activeJob.rowsSkipped ? ` · skipped ${activeJob.rowsSkipped.toLocaleString()} invalid rows` : ''}.`)
    setReportDataset(activeJob.rowsSkipped > 0
      ? { id: activeJob.datasetId, name: activeJob.datasetName, skippedRows: activeJob.rowsSkipped }
      : null)
    setReportOpen(false)
    void onUploaded().catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : 'Could not refresh the workspace.')
    })
  }, [activeJob, onError, onUploaded])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!file) return
    if (file.size > MAX_CSV_UPLOAD_BYTES) {
      setFileError('This CSV is over the 200 MB upload limit.')
      return
    }
    setBusy(true)
    setProgress(0)
    setSuccess('')
    setFileError('')
    onError('')
    try {
      const datasetName = name.trim() || file.name.replace(/\.csv$/i, '')
      const result = await api.upload(file, datasetName, setProgress)
      setActiveJob({
        jobId: result.jobId,
        datasetId: result.datasetId,
        datasetName,
        status: 'Queued',
        progress: 0,
        rowsProcessed: 0,
        rowsSkipped: 0,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      })
      setJobStatusError('')
      completedJobId.current = null
      setSuccess('')
      setReportDataset(null)
      setFile(null)
      setName('')
      if (fileInput.current) fileInput.current.value = ''
      await onUploaded()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Upload failed.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const cancelJob = async () => {
    if (!activeJob) return
    setJobActionBusy(true)
    try {
      setActiveJob(await api.cancelImport(activeJob.jobId))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not cancel this import.')
    } finally {
      setJobActionBusy(false)
    }
  }

  const retryJob = async () => {
    if (!activeJob) return
    setJobActionBusy(true)
    try {
      setActiveJob(await api.retryImport(activeJob.jobId))
      setSuccess('')
      onError('')
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not retry this import.')
    } finally {
      setJobActionBusy(false)
    }
  }

  const jobIsActive = activeJob?.status === 'Queued' || activeJob?.status === 'Running'

  return (
    <div className="grid w-full gap-3 lg:w-[58%] lg:max-w-[670px]">
      <form className="grid w-full grid-cols-1 items-end gap-3 rounded-xl border border-border bg-surface p-3.5 md:grid-cols-[minmax(150px,1fr)_minmax(150px,0.8fr)_auto]" onSubmit={(event) => void submit(event)}>
        <label className="flex min-h-[42px] cursor-pointer items-center gap-2.5 overflow-hidden text-sm text-foreground">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-lg text-primary" aria-hidden="true">↑</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{file ? file.name : 'Choose a CSV file'}</span>
          <input className="sr-only" ref={fileInput} type="file" accept=".csv,text/csv" onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null
            setFileError(chosen && chosen.size > MAX_CSV_UPLOAD_BYTES ? 'This CSV is over the 200 MB upload limit.' : '')
            setFile(chosen && chosen.size <= MAX_CSV_UPLOAD_BYTES ? chosen : null)
            if (chosen && chosen.size <= MAX_CSV_UPLOAD_BYTES && !name) setName(chosen.name.replace(/\.csv$/i, ''))
          }} />
        </label>
        <label className="grid gap-1.5 text-left text-xs font-semibold text-muted">Dataset name<input className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} placeholder="e.g. Monthly sales" /></label>
        <button className="inline-flex min-h-10 whitespace-nowrap items-center justify-center rounded-lg border border-transparent bg-primary px-3.5 py-2 font-semibold text-background hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!file || busy || Boolean(jobIsActive)}>{busy ? `Uploading ${progress ?? 0}%` : 'Import CSV'}</button>
        {busy && <progress className="col-span-full w-full accent-success" value={progress ?? 0} max={100} aria-label="Upload progress" />}
        <span className="col-span-full text-xs text-muted">CSV only · up to 200 MB</span>
        {fileError && <span className="col-span-full text-sm text-danger" role="alert">{fileError}</span>}
        {success && <span className="col-span-full text-sm text-success" role="status">{success}</span>}
        {activeJob && (
          <div className="col-span-full grid gap-2 rounded-lg border border-border bg-surface-raised p-3 text-xs text-foreground" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-2.5">
              <strong>{activeJob.datasetName}: {activeJob.status}</strong>
              <span>{activeJob.rowsProcessed.toLocaleString()} rows</span>
            </div>
            {jobIsActive && (
              <>
                <progress className="col-span-full w-full accent-success" value={activeJob.progress} max={100} aria-label="Import progress" />
                <button type="button" className="min-h-8 justify-self-start rounded px-1 text-primary hover:bg-surface disabled:opacity-50" disabled={jobActionBusy} onClick={() => void cancelJob()}>
                  {jobActionBusy ? 'Please wait…' : 'Cancel import'}
                </button>
              </>
            )}
            {activeJob.status === 'Failed' && <span className="text-sm text-danger">{activeJob.errorMessage ?? 'Import failed.'}</span>}
            {activeJob.status === 'Cancelled' && <span className="text-xs text-muted">Import cancelled.</span>}
            {jobStatusError && <span className="text-sm text-danger">{jobStatusError}</span>}
            {(activeJob.status === 'Failed' || activeJob.status === 'Cancelled') && (
              <button type="button" className="min-h-8 justify-self-start rounded px-1 text-primary hover:bg-surface disabled:opacity-50" disabled={jobActionBusy} onClick={() => void retryJob()}>
                {jobActionBusy ? 'Please wait…' : 'Retry import'}
              </button>
            )}
          </div>
        )}
        {reportDataset && (
          <button className="col-span-full min-h-8 justify-self-start rounded px-1 text-primary hover:bg-surface-raised" type="button" onClick={() => setReportOpen(!reportOpen)}>
            {reportOpen ? 'Hide import report' : `View import report (${reportDataset.skippedRows} skipped)`}
          </button>
        )}
      </form>
      {reportDataset && reportOpen && (
        <ImportReportPanel
          datasetId={reportDataset.id}
          datasetName={reportDataset.name}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  )
}

function ImportReportPanel({
  datasetId,
  datasetName,
  onClose,
}: {
  datasetId: string
  datasetName: string
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<ImportErrorPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api.get<ImportErrorPage>(`/datasets/${datasetId}/import-errors?page=${page}&pageSize=25`)
      .then((response) => {
        if (!active) return
        setResult(response)
        setError('')
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load the import report.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [datasetId, page])

  const downloadCsv = async () => {
    setDownloading(true)
    setError('')
    try {
      await downloadImportErrorsCsv(datasetId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download the report.')
    } finally {
      setDownloading(false)
    }
  }

  const canGoForward = result !== null && result.page * result.pageSize < result.totalErrors

  return (
    <section className="rounded-xl border border-border bg-surface p-3.5 text-foreground" aria-label={`${datasetName} import report`}>
      <div className="flex items-center justify-between gap-2.5">
        <div>
          <h2 className="m-0 text-base font-semibold text-foreground">Import report</h2>
          <p className="mt-1 text-xs text-muted">{datasetName} · {result?.rowsSkipped ?? '—'} rows skipped</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground hover:brightness-105 disabled:opacity-50" type="button" disabled={downloading || loading} onClick={() => void downloadCsv()}>
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
          <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground hover:brightness-105" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      {error && <div className="my-3 rounded-lg border border-danger/50 bg-danger/10 px-3.5 py-3 text-danger" role="alert">{error}</div>}
      {loading ? (
        <p className="text-xs text-muted" role="status">Loading skipped-row details…</p>
      ) : result && result.errors.length === 0 ? (
        <p className="text-xs text-muted">No row-level errors were recorded.</p>
      ) : result ? (
        <>
          <div className="mt-3.5 max-h-[260px] overflow-auto rounded-lg border border-border">
            <table className="min-w-[520px] whitespace-normal text-left text-xs">
              <thead><tr>{['Row', 'Column', 'Value', 'Reason'].map((header) => <th className="sticky top-0 border-b border-border bg-surface-raised px-3 py-2.5 text-foreground" key={header}>{header}</th>)}</tr></thead>
              <tbody>
                {result.errors.map((item, index) => (
                  <tr key={`${item.rowNumber}-${item.columnName ?? 'row'}-${index}`}>
                    <td className="max-w-[210px] [overflow-wrap:anywhere] border-b border-border/70 px-3 py-2.5 text-foreground">{item.rowNumber}</td>
                    <td className="max-w-[210px] [overflow-wrap:anywhere] border-b border-border/70 px-3 py-2.5 text-foreground">{item.columnName ?? 'Row'}</td>
                    <td className="max-w-[210px] [overflow-wrap:anywhere] border-b border-border/70 px-3 py-2.5 text-foreground">{item.rawValue ?? '—'}</td>
                    <td className="max-w-[210px] [overflow-wrap:anywhere] border-b border-border/70 px-3 py-2.5 text-foreground">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2.5 text-xs text-muted">
            <span>{result.totalErrors.toLocaleString()} issues · page {result.page}</span>
            <div className="flex items-center gap-2">
              <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground hover:brightness-105 disabled:opacity-50" type="button" disabled={result.page <= 1} onClick={() => { setLoading(true); setPage(page - 1) }}>Previous</button>
              <button className="min-h-9 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground hover:brightness-105 disabled:opacity-50" type="button" disabled={!canGoForward} onClick={() => { setLoading(true); setPage(page + 1) }}>Next</button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <article className="grid gap-3 rounded-xl border border-border bg-surface p-[18px]"><span className="text-sm text-muted">{label}</span><strong className="text-2xl text-foreground">{value}</strong></article>
}

export default App
