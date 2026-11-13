import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Select, type SelectOption } from '../../components/Select'
import { ThemeToggle } from '../../theme'
import {
  api,
  chartTypes,
  type ChartPreviewResponse,
  type ChartType,
  type Dataset,
  type DatasetAnalyticsRequest,
  type DatasetColumn,
  type SavedChart,
} from '../../lib/api'
import { ChartPreviewCard } from './ChartVisualization'
import {
  chartPalettes,
  defaultChartConfig,
  deserializeChartConfig,
  serializeChartConfig,
  type ChartConfig,
} from './chartUtils'

const chartLabels: Record<ChartType, string> = {
  bar: 'Bar',
  'horizontal-bar': 'Horizontal bar',
  'stacked-bar': 'Stacked bar',
  line: 'Line',
  'multi-line': 'Multi-line',
  area: 'Area',
  'stacked-area': 'Stacked area',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  kpi: 'KPI number',
  table: 'Table',
}

const EMPTY_COLUMNS: DatasetColumn[] = []

function ProductNav({ active }: { active: 'dashboard' | 'datasets' | 'charts' }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border/75 pb-4">
      <Link to="/" className="text-lg font-bold text-foreground no-underline">DataLens</Link>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Workspace navigation">
        {([
          ['dashboard', 'Dashboard', '/'],
          ['datasets', 'Datasets', '/datasets'],
          ['charts', 'Charts', '/charts'],
        ] as const).map(([key, label, href]) => (
          <Link className={`rounded-lg px-3 py-2 text-sm font-semibold no-underline ${active === key ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surface-raised hover:text-foreground'}`} to={href} key={key} aria-current={active === key ? 'page' : undefined}>{label}</Link>
        ))}
        <ThemeToggle />
      </nav>
    </header>
  )
}

export function ChartLibraryPage() {
  const [search, setSearch] = useState('')
  const [datasetFilter, setDatasetFilter] = useState('')
  const chartQuery = useQuery({ queryKey: ['charts'], queryFn: () => api.get<SavedChart[]>('/charts') })
  const datasetQuery = useQuery({ queryKey: ['datasets'], queryFn: () => api.get<Dataset[]>('/datasets') })
  const charts = chartQuery.data ?? []
  const filtered = charts.filter(chart =>
    chart.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    && (!datasetFilter || chart.datasetId === datasetFilter))
  const datasets = datasetQuery.data ?? []
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const duplicate = async (chart: SavedChart) => {
    try {
      const { id: _id, version: _version, createdAt: _createdAt, updatedAt: _updatedAt, datasetName: _datasetName, ...body } = chart
      const copy = await api.post<SavedChart>('/charts', { ...body, name: `${chart.name} copy` })
      await chartQuery.refetch()
      navigate(`/charts/${copy.id}/edit`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not duplicate this chart.')
    }
  }

  const remove = async (chart: SavedChart) => {
    if (!window.confirm(`Delete "${chart.name}"? It will also be removed from dashboards.`)) return
    try {
      await api.delete(`/charts/${chart.id}`)
      await chartQuery.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this chart.')
    }
  }

  if (!sessionStorage.getItem('datalens.accessToken')) return <Navigate to="/datasets" replace />
  return (
    <main className="mx-auto w-[calc(100%-2rem)] max-w-[1200px] py-6 pb-16">
      <ProductNav active="charts" />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">Your library</p><h1 className="m-0 text-3xl font-bold text-foreground">Charts</h1><p className="mt-2 text-muted">Saved visualizations across all your datasets.</p></div>
        <Link className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-background no-underline" to="/charts/new">Create chart</Link>
      </div>
      {error && <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger" role="alert">{error}</p>}
      <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
        <label className="grid gap-1 text-xs font-semibold text-muted">Search charts
          <input className="min-h-10 rounded-lg border border-border bg-surface px-3 text-foreground" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by chart name" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted">Filter by dataset
          <Select label="Filter by dataset" value={datasetFilter} options={[{ value: '', label: 'All datasets' }, ...datasets.map(dataset => ({ value: dataset.id, label: dataset.name }))]} onChange={setDatasetFilter} searchable />
        </label>
      </div>
      {chartQuery.isPending ? <p className="py-12 text-center text-muted" role="status">Loading charts…</p>
        : chartQuery.isError ? <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-danger" role="alert">Could not load your charts. <button className="ml-2 underline" type="button" onClick={() => void chartQuery.refetch()}>Try again</button></div>
          : filtered.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center"><h2 className="text-xl font-semibold text-foreground">{charts.length ? 'No matching charts' : 'Your chart library is empty'}</h2><p className="mt-2 text-muted">Create reusable charts and add them to any dashboard.</p>{!charts.length && <Link className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-background no-underline" to="/charts/new">Create your first chart</Link>}</div>
            : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map(chart => <article className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface p-4" key={chart.id}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-lg font-semibold text-foreground">{chart.name}</h2><p className="mt-1 truncate text-sm text-muted">{chart.datasetName} · {chartLabels[chart.chartType]}</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary" aria-label={`${chartLabels[chart.chartType]} chart`}>{chartLabels[chart.chartType].slice(0, 3).toUpperCase()}</span></div>
                <SavedChartMiniPreview chart={chart} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-background no-underline" to={`/charts/${chart.id}/edit`}>Edit</Link>
                  <button className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs font-semibold text-foreground" type="button" onClick={() => void duplicate(chart)}>Duplicate</button>
                  <button className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-danger" type="button" onClick={() => void remove(chart)}>Delete</button>
                </div>
              </article>)}
            </div>}
    </main>
  )
}

function SavedChartMiniPreview({ chart }: { chart: SavedChart }) {
  const query = useQuery({
    queryKey: ['chart-preview', chart.id],
    queryFn: () => api.get<ChartPreviewResponse>(`/charts/${chart.id}/preview`),
  })
  if (query.isError) return <div className="mt-3 grid h-36 place-items-center rounded-lg border border-border bg-surface-raised text-xs text-muted">Preview unavailable</div>
  return <div className="mt-3">{query.data
    ? <ChartPreviewCard preview={query.data} type={chart.chartType} options={chart.options} compact />
    : <div className="grid h-36 place-items-center rounded-lg border border-border bg-surface-raised text-xs text-muted" role="status">Loading preview…</div>}</div>
}

export function ChartEditorPage() {
  const { chartId } = useParams()
  const [routeSearchParams] = useSearchParams()
  const chartQuery = useQuery({
    queryKey: ['chart', chartId],
    queryFn: () => api.get<SavedChart>(`/charts/${chartId}`),
    enabled: Boolean(chartId),
  })

  if (!sessionStorage.getItem('datalens.accessToken')) return <Navigate to="/datasets" replace />
  if (chartId && chartQuery.isPending) return <main className="p-8 text-center text-muted" role="status">Loading chart…</main>
  if (chartId && chartQuery.isError) return <main className="p-8 text-center text-danger" role="alert">Could not load this chart.</main>
  const initialConfig = chartQuery.data
    ? chartToConfig(chartQuery.data)
    : deserializeChartConfig(`?${routeSearchParams.toString()}`, defaultChartConfig(routeSearchParams.get('dataset') ?? ''))

  return <ChartEditorForm key={chartId ?? 'new'} chartId={chartId} initialConfig={initialConfig} />
}

function ChartEditorForm({ chartId, initialConfig }: { chartId?: string; initialConfig: ChartConfig }) {
  const [, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [config, setConfig] = useState<ChartConfig>(initialConfig)
  const [debouncedConfig, setDebouncedConfig] = useState(config)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: () => api.get<Dataset[]>('/datasets') })
  const datasetQuery = useQuery({
    queryKey: ['dataset', config.datasetId],
    queryFn: () => api.get<Dataset>(`/datasets/${config.datasetId}`),
    enabled: Boolean(config.datasetId),
  })
  const datasets = datasetsQuery.data ?? []
  const columns = datasetQuery.data?.columns ?? EMPTY_COLUMNS

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedConfig(config), 300)
    return () => window.clearTimeout(timer)
  }, [config])

  useEffect(() => {
    setSearchParams(serializeChartConfig(config), { replace: true })
  }, [config, setSearchParams])

  const preview = useQuery({
    queryKey: ['chart-builder-preview', debouncedConfig],
    queryFn: ({ signal }) => api.post<ChartPreviewResponse>('/charts/preview', {
      datasetId: debouncedConfig.datasetId,
      chartType: debouncedConfig.chartType,
      query: normalizeQuery(debouncedConfig.query),
    }, signal),
    enabled: Boolean(debouncedConfig.datasetId && columns.length),
    placeholderData: previous => previous,
  })

  const numericColumns = useMemo(() => columns.filter(isNumeric), [columns])
  const selectedPalette = Object.entries(chartPalettes).find(([, colors]) =>
    colors.length === config.options.colors.length && colors.every((color, index) => config.options.colors[index] === color))?.[0] ?? 'ocean'
  const mutateConfig = (updates: Partial<ChartConfig>) => setConfig(current => ({ ...current, ...updates }))
  const updateQuery = (updates: Partial<DatasetAnalyticsRequest>) => setConfig(current => ({
    ...current,
    query: normalizeQuery({ ...current.query, ...updates }),
  }))
  const updateOptions = (updates: Partial<ChartConfig['options']>) => setConfig(current => ({ ...current, options: { ...current.options, ...updates } }))

  const setDataset = (datasetId: string) => {
    const next = defaultChartConfig(datasetId)
    next.name = config.name
    next.description = config.description
    next.chartType = config.chartType
    setConfig(next)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    const body = {
      name: config.name,
      description: config.description,
      datasetId: config.datasetId,
      chartType: config.chartType,
      query: normalizeQuery(config.query),
      options: config.options,
    }
    try {
      if (chartId) await api.put<SavedChart>(`/charts/${chartId}`, body)
      else await api.post<SavedChart>('/charts', body)
      navigate('/charts')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this chart.')
    } finally {
      setSaving(false)
    }
  }

  const selectedGroups = config.query.groupByPositions ?? (config.query.groupByPosition === null ? [] : [config.query.groupByPosition ?? 0])
  const changeGroup = (index: number, position: number | null) => {
    const next = [...selectedGroups]
    if (position === null) next.splice(index, 1)
    else next[index] = position
    updateQuery({ groupByPositions: next, groupByPosition: next[0] ?? null })
  }
  const columnOptions = (predicate: (column: DatasetColumn) => boolean = () => true): SelectOption[] =>
    columns.filter(predicate).map(column => ({ value: String(column.position), label: `${column.name} · ${column.typeName}` }))
  const updateMetric = (index: number, metric: DatasetAnalyticsRequest['metrics'][number]) =>
    updateQuery({ metrics: config.query.metrics.map((item, current) => current === index ? metric : item) })

  return (
    <main className="mx-auto w-[calc(100%-2rem)] max-w-[1440px] py-6 pb-16">
      <ProductNav active="charts" />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-primary">Chart builder</p><h1 className="m-0 text-3xl font-bold text-foreground">{chartId ? 'Edit chart' : 'Create chart'}</h1></div><div className="flex gap-2"><Link className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground no-underline" to="/charts">Cancel</Link><button className="rounded-lg bg-primary px-4 py-2 font-semibold text-background disabled:opacity-50" type="button" disabled={saving || !config.datasetId} onClick={() => void save()}>{saving ? 'Saving…' : 'Save chart'}</button></div></div>
      {error && <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger" role="alert">{error}</p>}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(330px,0.78fr)_minmax(0,1.22fr)]">
        <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="chart-settings">
          <h2 className="m-0 text-lg font-semibold text-foreground" id="chart-settings">Configuration</h2>
          <label className="grid gap-1.5 text-xs font-semibold text-muted">Chart name<input className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-foreground" value={config.name} onChange={event => mutateConfig({ name: event.target.value })} maxLength={200} /></label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted">Description<input className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-foreground" value={config.description} onChange={event => mutateConfig({ description: event.target.value })} maxLength={1000} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-muted">Dataset
              <Select label="Dataset" value={config.datasetId} options={datasets.map(dataset => ({ value: dataset.id, label: dataset.name }))} onChange={setDataset} searchable />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-muted">Chart type
              <Select label="Chart type" value={config.chartType} options={chartTypes.map(type => ({ value: type, label: chartLabels[type] }))} onChange={value => mutateConfig({ chartType: value as ChartType })} searchable />
            </label>
          </div>
          {datasetQuery.isError && <p role="alert" className="text-sm text-danger">Could not load this dataset schema.</p>}
          {columns.length > 0 && <>
            <div className="grid gap-3 rounded-lg border border-border bg-surface-raised p-3">
              <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-semibold text-foreground">Metrics</h3><button className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground disabled:opacity-50" type="button" disabled={config.query.metrics.length >= 5} onClick={() => updateQuery({ metrics: [...config.query.metrics, { function: 'count', columnPosition: null }] })}>Add metric</button></div>
              {config.query.metrics.map((metric, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]" key={index}>
                <Select label={`Metric ${index + 1} aggregation`} value={metric.function} options={['count', 'sum', 'avg', 'min', 'max'].map(value => ({ value, label: value.toUpperCase(), disabled: value === 'sum' || value === 'avg' ? numericColumns.length === 0 : false }))} onChange={value => updateMetric(index, { function: value, columnPosition: value === 'count' && metric.columnPosition === null ? null : numericColumns[0]?.position ?? metric.columnPosition })} />
                <Select label={`Metric ${index + 1} column`} value={metric.columnPosition === null ? '' : String(metric.columnPosition)} options={[{ value: '', label: 'Count rows' }, ...columnOptions(metric.function === 'sum' || metric.function === 'avg' ? isNumeric : () => true)]} onChange={value => updateMetric(index, { ...metric, columnPosition: value === '' ? null : Number(value) })} searchable />
                {config.query.metrics.length > 1 && <button className="rounded-md px-2 text-xs font-semibold text-danger" type="button" aria-label={`Remove metric ${index + 1}`} onClick={() => updateQuery({ metrics: config.query.metrics.filter((_, current) => current !== index) })}>Remove</button>}
              </div>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map(index => <label className="grid gap-1.5 text-xs font-semibold text-muted" key={index}>{index === 0 ? 'X axis / group by' : 'Series split'}
                <Select label={index === 0 ? 'X axis / group by' : 'Series split'} value={selectedGroups[index] === undefined ? '' : String(selectedGroups[index])} options={[{ value: '', label: index === 0 ? 'No grouping' : 'No series split' }, ...columnOptions()]} onChange={value => changeGroup(index, value ? Number(value) : null)} searchable />
              </label>)}
            </div>
            {columns.some(column => column.typeName === 'date' || column.typeName === 'datetime') && <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-semibold text-muted">Time column<Select label="Time column" value={config.query.timeBucketPosition === undefined || config.query.timeBucketPosition === null ? '' : String(config.query.timeBucketPosition)} options={[{ value: '', label: 'No time bucket' }, ...columnOptions(column => column.typeName === 'date' || column.typeName === 'datetime')]} onChange={value => updateQuery({ timeBucketPosition: value ? Number(value) : null, timeBucket: value ? config.query.timeBucket ?? 'month' : null })} searchable /></label>
              <label className="grid gap-1.5 text-xs font-semibold text-muted">Time bucket<Select label="Time bucket" value={config.query.timeBucket ?? 'month'} options={['day', 'week', 'month', 'quarter', 'year'].map(value => ({ value, label: value }))} onChange={value => updateQuery({ timeBucket: value as NonNullable<DatasetAnalyticsRequest['timeBucket']> })} /></label>
            </div>}
            <div className="grid gap-3 rounded-lg border border-border bg-surface-raised p-3">
              <div className="flex items-center justify-between"><h3 className="m-0 text-sm font-semibold text-foreground">Filters (AND)</h3><button className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground" type="button" onClick={() => updateQuery({ filters: [...config.query.filters, { columnPosition: columns[0]?.position ?? 0, operator: 'eq', value: '' }] })}>Add filter</button></div>
              {config.query.filters.map((filter, index) => {
                const column = columns.find(item => item.position === filter.columnPosition)
                const operators = column?.typeName === 'text' ? ['eq', 'neq', 'contains', 'startswith', 'isNull', 'isNotNull'] : ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull']
                const valueless = filter.operator === 'isNull' || filter.operator === 'isNotNull'
                return <div className="grid gap-2 sm:grid-cols-[1fr_0.8fr_1fr_auto]" key={index}>
                  <Select label={`Filter ${index + 1} column`} value={String(filter.columnPosition)} options={columnOptions()} onChange={value => updateQuery({ filters: config.query.filters.map((item, current) => current === index ? { ...item, columnPosition: Number(value), operator: 'eq' } : item) })} searchable />
                  <Select label={`Filter ${index + 1} operator`} value={filter.operator} options={operators.map(operator => ({ value: operator, label: operator }))} onChange={operator => updateQuery({ filters: config.query.filters.map((item, current) => current === index ? { ...item, operator, value: null } : item) })} />
                  {!valueless && <input aria-label={`Filter ${index + 1} value`} className="min-h-10 min-w-0 rounded-lg border border-border bg-surface px-2 text-foreground" type={column?.typeName === 'date' ? 'date' : column?.typeName === 'integer' || column?.typeName === 'decimal' || column?.typeName === 'number' ? 'number' : 'text'} value={filter.value ?? ''} onChange={event => updateQuery({ filters: config.query.filters.map((item, current) => current === index ? { ...item, value: event.target.value } : item) })} />}
                  <button className="px-2 text-xs font-semibold text-danger" type="button" aria-label={`Remove filter ${index + 1}`} onClick={() => updateQuery({ filters: config.query.filters.filter((_, current) => current !== index) })}>Remove</button>
                </div>
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-xs font-semibold text-muted">Sort metric<Select label="Sort metric" value={config.query.sortBy ?? 'm0'} options={[...config.query.metrics.map((_, index) => ({ value: `m${index}`, label: `Metric ${index + 1}` })), ...selectedGroups.map((_, index) => ({ value: index === 0 ? 'groupValue' : `groupValue${index}`, label: `Group ${index + 1}` }))]} onChange={value => updateQuery({ sortBy: value })} /></label>
              <label className="grid gap-1 text-xs font-semibold text-muted">Direction<Select label="Sort direction" value={config.query.sortDirection ?? 'desc'} options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]} onChange={value => updateQuery({ sortDirection: value as 'asc' | 'desc' })} /></label>
              <label className="grid gap-1 text-xs font-semibold text-muted">Top N<input className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-foreground" type="number" min={1} max={500} value={config.query.topN} onChange={event => updateQuery({ topN: Number(event.target.value) })} /></label>
            </div>
            <div className="grid gap-3 rounded-lg border border-border bg-surface-raised p-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold text-muted">Chart title<input className="min-h-10 rounded-lg border border-border bg-surface px-3 text-foreground" value={config.options.title} onChange={event => updateOptions({ title: event.target.value })} /></label>
              <label className="grid gap-1 text-xs font-semibold text-muted">Number format<Select label="Number format" value={config.options.numberFormat} options={['auto', 'number', 'integer', 'percent', 'currency'].map(value => ({ value, label: value }))} onChange={value => updateOptions({ numberFormat: value as ChartConfig['options']['numberFormat'] })} /></label>
              <label className="grid gap-1 text-xs font-semibold text-muted">Color palette<Select label="Color palette" value={selectedPalette} options={Object.keys(chartPalettes).map(value => ({ value, label: `${value.charAt(0).toUpperCase()}${value.slice(1)}` }))} onChange={value => { const colors = chartPalettes[value as keyof typeof chartPalettes]; if (colors) updateOptions({ colors: [...colors] }) }} /></label>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={config.options.showLegend} onChange={event => updateOptions({ showLegend: event.target.checked })} />Show legend</label>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={config.options.stacked} onChange={event => updateOptions({ stacked: event.target.checked })} />Stack series</label>
              <label className="grid gap-1 text-xs font-semibold text-muted">X-axis label<input className="min-h-10 rounded-lg border border-border bg-surface px-3 text-foreground" value={config.options.xAxisLabel} onChange={event => updateOptions({ xAxisLabel: event.target.value })} /></label>
              <label className="grid gap-1 text-xs font-semibold text-muted">Y-axis label<input className="min-h-10 rounded-lg border border-border bg-surface px-3 text-foreground" value={config.options.yAxisLabel} onChange={event => updateOptions({ yAxisLabel: event.target.value })} /></label>
            </div>
          </>}
        </section>
        <section className="min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="chart-preview">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="m-0 text-lg font-semibold text-foreground" id="chart-preview">Live preview</h2><p className="mt-1 text-sm text-muted">{datasets.find(dataset => dataset.id === debouncedConfig.datasetId)?.name ?? 'Choose a dataset'}</p></div>{preview.isFetching && <span className="text-xs text-muted" role="status">Updating…</span>}</div>
          {!config.datasetId ? <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-border text-sm text-muted">Choose a dataset to preview this chart.</div>
            : preview.isError ? <div className="grid min-h-64 place-items-center rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger" role="alert">{preview.error instanceof Error ? preview.error.message : 'Could not load preview.'}<button className="underline" type="button" onClick={() => void preview.refetch()}>Retry</button></div>
              : <ChartPreviewCard preview={preview.data} type={config.chartType} options={config.options} />}
        </section>
      </div>
    </main>
  )
}

function chartToConfig(chart: SavedChart): ChartConfig {
  const base = defaultChartConfig(chart.datasetId)
  return {
    ...base,
    name: chart.name,
    description: chart.description,
    chartType: chart.chartType,
    query: normalizeQuery(chart.query),
    options: {
      ...base.options,
      ...chart.options,
      title: chart.options.title ?? '',
      xAxisLabel: chart.options.xAxisLabel ?? '',
      yAxisLabel: chart.options.yAxisLabel ?? '',
      colors: chart.options.colors ?? base.options.colors,
    },
  }
}

function normalizeQuery(query: DatasetAnalyticsRequest): DatasetAnalyticsRequest {
  return {
    ...query,
    groupByPositions: query.groupByPositions ?? (query.groupByPosition === null || query.groupByPosition === undefined ? [] : [query.groupByPosition]),
    groupByPosition: query.groupByPositions?.[0] ?? query.groupByPosition ?? null,
    metrics: query.metrics?.length ? query.metrics : [{ function: 'count', columnPosition: null }],
    filters: query.filters ?? [],
    topN: Math.min(500, Math.max(1, Number(query.topN) || 50)),
    sortBy: query.sortBy ?? 'm0',
    sortDirection: query.sortDirection ?? 'desc',
  }
}

function isNumeric(column: DatasetColumn) {
  return column.typeName === 'integer' || column.typeName === 'decimal' || column.typeName === 'number'
}
