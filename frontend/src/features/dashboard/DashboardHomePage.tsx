import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Select } from '../../components/Select'
import { ThemeToggle } from '../../theme'
import {
  api,
  type ChartPreviewResponse,
  type Dashboard,
  type DashboardWidget,
  type SavedChart,
} from '../../lib/api'
import { ChartPreviewCard } from '../charts/ChartVisualization'

interface WidgetLayout {
  savedChartId: string
  x: number
  y: number
  width: number
  height: number
  titleOverride: string | null
}

const EMPTY_DASHBOARDS: Dashboard[] = []
const EMPTY_CHARTS: SavedChart[] = []
const EMPTY_WIDGETS: DashboardWidget[] = []

export function DashboardHomePage() {
  const [selectedId, setSelectedId] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [layoutOverride, setLayoutOverride] = useState<DashboardWidget[] | null>(null)
  const [saveMessage, setSaveMessage] = useState('Saved')
  const [error, setError] = useState('')
  const [showChartPicker, setShowChartPicker] = useState(false)
  const [chartSearch, setChartSearch] = useState('')
  const [newDashboardName, setNewDashboardName] = useState('')
  const [draggedChartId, setDraggedChartId] = useState<string | null>(null)
  const token = sessionStorage.getItem('datalens.accessToken')
  const queryClient = useQueryClient()
  const dashboardList = useQuery({
    queryKey: ['dashboards'],
    queryFn: () => api.get<Dashboard[]>('/dashboards'),
    enabled: Boolean(token),
  })
  const dashboards = dashboardList.data ?? EMPTY_DASHBOARDS
  const activeDashboardId = selectedId || dashboards.find(dashboard => dashboard.isDefault)?.id || dashboards[0]?.id || ''

  const dashboardQuery = useQuery({
    queryKey: ['dashboard-detail', activeDashboardId],
    queryFn: () => api.get<Dashboard>(`/dashboards/${activeDashboardId}`),
    enabled: Boolean(token && activeDashboardId),
  })
  const refetchDashboard = dashboardQuery.refetch
  const chartList = useQuery({
    queryKey: ['charts'],
    queryFn: () => api.get<SavedChart[]>('/charts'),
    enabled: showChartPicker,
  })
  const currentDashboard = dashboardQuery.data
  const charts = chartList.data ?? EMPTY_CHARTS
  const layout = layoutOverride ?? currentDashboard?.widgets ?? EMPTY_WIDGETS
  const dirty = layoutOverride !== null

  useEffect(() => {
    if (!dirty || !currentDashboard) return
    const timer = window.setTimeout(() => {
      const body = {
        version: currentDashboard.version,
        widgets: layout.map(widget => ({
          savedChartId: widget.savedChartId,
          x: widget.x,
          y: widget.y,
          width: widget.width,
          height: widget.height,
          titleOverride: widget.titleOverride,
        })),
      }
      void api.put<Dashboard>(`/dashboards/${currentDashboard.id}/layout`, body)
        .then(updated => {
          queryClient.setQueryData(['dashboard-detail', currentDashboard.id], updated)
          setLayoutOverride(null)
          setSaveMessage('Saved')
        })
        .catch(async cause => {
          setError(cause instanceof Error && 'status' in cause && cause.status === 409
            ? 'Another session changed this dashboard. The latest layout was reloaded.'
            : cause instanceof Error ? cause.message : 'Could not save dashboard layout.')
          setSaveMessage('Save failed')
          setLayoutOverride(null)
          await refetchDashboard()
        })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [dirty, layout, currentDashboard, queryClient, refetchDashboard])

  const filteredCharts = useMemo(() => charts.filter(chart =>
    chart.name.toLocaleLowerCase().includes(chartSearch.toLocaleLowerCase())
    || chart.datasetName.toLocaleLowerCase().includes(chartSearch.toLocaleLowerCase())), [charts, chartSearch])

  if (!token) return <Navigate to="/welcome" replace />

  const createDashboard = async () => {
    const name = newDashboardName.trim()
    if (!name) return
    try {
      const dashboard = await api.post<Dashboard>('/dashboards', { name })
      setNewDashboardName('')
      setSelectedId(dashboard.id)
      await dashboardList.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create dashboard.')
    }
  }

  const addChart = async (chart: SavedChart) => {
    if (!currentDashboard) return
    try {
      await api.post(`/dashboards/${currentDashboard.id}/widgets`, {
        savedChartId: chart.id,
        x: 0,
        y: layout.reduce((maximum, widget) => Math.max(maximum, widget.y + widget.height), 0),
        width: 6,
        height: 4,
      })
      setShowChartPicker(false)
      await dashboardQuery.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add chart.')
    }
  }

  const updateWidget = (widgetId: string, updates: Partial<WidgetLayout>) => {
    setLayoutOverride(current => (current ?? layout).map(widget => widget.id === widgetId ? { ...widget, ...updates } : widget))
    setSaveMessage('Unsaved changes')
  }

  const moveWidget = (widget: DashboardWidget, direction: -1 | 1) => {
    const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
    const index = ordered.findIndex(item => item.id === widget.id)
    const target = ordered[index + direction]
    if (!target) return
    const currentPosition = { x: widget.x, y: widget.y }
    updateWidget(widget.id, { x: target.x, y: target.y })
    updateWidget(target.id, currentPosition)
  }

  const removeWidget = async (widget: DashboardWidget) => {
    if (!currentDashboard) return
    try {
      await api.delete(`/dashboards/${currentDashboard.id}/widgets/${widget.id}`)
      await dashboardQuery.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this chart.')
    }
  }

  const setDefault = async () => {
    if (!currentDashboard) return
    try {
      await api.post(`/dashboards/${currentDashboard.id}/default`, {})
      await dashboardList.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not set the default dashboard.')
    }
  }

  return (
    <main className="mx-auto w-[calc(100%-2rem)] max-w-[1440px] py-6 pb-16">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border/75 pb-4">
        <Link to="/" className="text-lg font-bold text-foreground no-underline">DataLens</Link>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Workspace navigation">
          <Link className="rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary no-underline" to="/" aria-current="page">Dashboard</Link>
          <Link className="rounded-lg px-3 py-2 text-sm font-semibold text-muted no-underline hover:bg-surface-raised" to="/datasets">Datasets</Link>
          <Link className="rounded-lg px-3 py-2 text-sm font-semibold text-muted no-underline hover:bg-surface-raised" to="/charts">Charts</Link>
          <Link className="rounded-lg px-3 py-2 text-sm font-semibold text-muted no-underline hover:bg-surface-raised" to="/exports">Exports</Link>
          <Link className="rounded-lg px-3 py-2 text-sm font-semibold text-muted no-underline hover:bg-surface-raised" to="/settings">Settings</Link>
          <ThemeToggle />
        </nav>
      </header>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">Your analytics</p><h1 className="m-0 text-3xl font-bold text-foreground">Dashboard</h1></div>
        <div className="flex flex-wrap items-end gap-2">
          {dashboards.length > 0 && <label className="grid min-w-48 gap-1 text-xs font-semibold text-muted">Dashboard
            <Select label="Dashboard" value={activeDashboardId} options={dashboards.map(item => ({ value: item.id, label: `${item.name}${item.isDefault ? ' · Default' : ''}` }))} onChange={id => { setSelectedId(id); setLayoutOverride(null) }} />
          </label>}
          <label className="grid gap-1 text-xs font-semibold text-muted">New board<input className="min-h-10 rounded-lg border border-border bg-surface px-3 text-foreground" value={newDashboardName} onChange={event => setNewDashboardName(event.target.value)} placeholder="Board name" /></label>
          <button className="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-background" type="button" disabled={!newDashboardName.trim()} onClick={() => void createDashboard()}>Create</button>
        </div>
      </div>

      {error && <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert">{error}<button className="underline" type="button" onClick={() => setError('')}>Dismiss</button></div>}
      {dashboardList.isError && <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-danger" role="alert">Could not load dashboards. <button className="underline" type="button" onClick={() => void dashboardList.refetch()}>Retry</button></div>}
      {dashboardList.isPending || dashboardQuery.isPending ? <div className="py-16 text-center text-muted" role="status">Loading dashboard…</div>
        : !currentDashboard ? <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center"><h2 className="text-2xl font-semibold text-foreground">Create your first dashboard</h2><p className="mx-auto mt-2 max-w-lg text-muted">Start a board, then add charts from any of your datasets.</p><Link className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-background no-underline" to="/charts/new">Create a chart</Link></div>
          : <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-semibold text-foreground">{currentDashboard.name}</span>
                {currentDashboard.isDefault ? <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">Default</span> : <button className="text-xs font-semibold text-primary underline" type="button" onClick={() => void setDefault()}>Set as default</button>}
                <span className="text-xs text-muted" aria-live="polite">{saveMessage}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={`rounded-lg border px-3 py-2 text-sm font-semibold ${editMode ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface-raised text-foreground'}`} type="button" aria-pressed={editMode} onClick={() => setEditMode(value => !value)}>{editMode ? 'Done editing' : 'Edit layout'}</button>
                {editMode && <button className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-background" type="button" onClick={() => { setChartSearch(''); setShowChartPicker(true) }}>Add chart</button>}
                <button className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground" type="button" onClick={() => void dashboardQuery.refetch()}>Refresh all</button>
                <button className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground" type="button" onClick={() => void document.documentElement.requestFullscreen?.()}>Present</button>
              </div>
            </div>
            {layout.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center"><h2 className="text-xl font-semibold text-foreground">No charts on this dashboard yet</h2><p className="mt-2 text-muted">Add an existing chart or create a new one to get started.</p><div className="mt-4 flex justify-center gap-2"><button className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-background" type="button" onClick={() => { setChartSearch(''); setShowChartPicker(true) }}>Add chart</button><Link className="rounded-lg border border-border px-4 py-2.5 font-semibold text-foreground no-underline" to="/charts/new">Create chart</Link></div></div>
              : <div className="grid auto-rows-[72px] grid-cols-12 gap-3" aria-label={`${currentDashboard.name} charts`}>
                {layout.map((widget, index) => <DashboardChartWidget
                  key={widget.id}
                  widget={widget}
                  editMode={editMode}
                  onResize={size => updateWidget(widget.id, size)}
                  onRemove={() => void removeWidget(widget)}
                  onMove={direction => moveWidget(widget, direction)}
                  onDragStart={() => setDraggedChartId(widget.id)}
                  onDrop={() => {
                    if (!draggedChartId || draggedChartId === widget.id) return
                    const source = layout.find(item => item.id === draggedChartId)
                    if (!source) return
                    const targetPosition = { x: widget.x, y: widget.y }
                    updateWidget(source.id, { x: targetPosition.x, y: targetPosition.y })
                    updateWidget(widget.id, { x: source.x, y: source.y })
                    setDraggedChartId(null)
                  }}
                  position={index}
                />)}
              </div>}
          </>}

      {showChartPicker && <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setShowChartPicker(false) }}>
        <section className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="add-chart-heading">
          <div className="flex items-start justify-between gap-4"><div><h2 className="m-0 text-xl font-bold text-foreground" id="add-chart-heading">Add a chart</h2><p className="mt-1 text-sm text-muted">Charts can come from any of your datasets.</p></div><button className="rounded-lg border border-border px-2 py-1 text-foreground" type="button" aria-label="Close chart picker" onClick={() => setShowChartPicker(false)}>×</button></div>
          <input className="my-4 min-h-10 w-full rounded-lg border border-border bg-surface-raised px-3 text-foreground" aria-label="Search saved charts" placeholder="Search charts and datasets" value={chartSearch} onChange={event => setChartSearch(event.target.value)} />
          {chartList.isPending ? <p className="text-muted" role="status">Loading charts…</p> : filteredCharts.length === 0 ? <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted"><p>No saved charts yet.</p><Link className="font-semibold text-primary" to="/charts/new">Create a new chart</Link></div>
            : <ul className="grid gap-2">{filteredCharts.map(chart => <li className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised p-3" key={chart.id}><div className="min-w-0"><strong className="block truncate text-foreground">{chart.name}</strong><span className="text-xs text-muted">{chart.datasetName} · {chart.chartType}</span></div><button className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-background" type="button" onClick={() => void addChart(chart)}>Add</button></li>)}</ul>}
          <Link className="mt-4 inline-flex font-semibold text-primary" to="/charts/new">Create a new chart</Link>
        </section>
      </div>}
    </main>
  )
}

function DashboardChartWidget({
  widget,
  editMode,
  onResize,
  onRemove,
  onMove,
  onDragStart,
  onDrop,
  position,
}: {
  widget: DashboardWidget
  editMode: boolean
  onResize: (size: Pick<DashboardWidget, 'width' | 'height'>) => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
  onDragStart: () => void
  onDrop: () => void
  position: number
}) {
  const preview = useQuery({
    queryKey: ['dashboard-widget-chart', widget.savedChartId],
    queryFn: () => api.get<ChartPreviewResponse>(`/charts/${widget.savedChartId}/preview`),
  })
  const span = widget.width >= 12 ? 'col-span-12' : widget.width >= 6 ? 'col-span-12 sm:col-span-6' : 'col-span-12 sm:col-span-3'
  const height = widget.height >= 6 ? 'row-span-6' : widget.height >= 4 ? 'row-span-4' : 'row-span-3'
  return (
    <article
      className={`${span} ${height} min-w-0 overflow-auto rounded-xl border ${editMode ? 'border-dashed border-primary/70' : 'border-border'} bg-surface p-3`}
      draggable={editMode}
      onDragStart={onDragStart}
      onDragOver={event => { if (editMode) event.preventDefault() }}
      onDrop={event => { if (editMode) { event.preventDefault(); onDrop() } }}
      aria-label={`${widget.titleOverride || widget.chart.name} chart widget`}
    >
      <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h2 className="m-0 truncate text-sm font-semibold text-foreground">{widget.titleOverride || widget.chart.options.title || widget.chart.name}</h2><p className="mt-0.5 truncate text-xs text-muted">{widget.chart.datasetName}</p></div>
        <div className="flex flex-wrap items-center gap-1">
          {editMode && <>
            <button className="rounded border border-border px-1.5 py-1 text-xs text-foreground" type="button" aria-label={`Move ${widget.chart.name} up`} onClick={() => onMove(-1)}>↑</button>
            <button className="rounded border border-border px-1.5 py-1 text-xs text-foreground" type="button" aria-label={`Move ${widget.chart.name} down`} onClick={() => onMove(1)}>↓</button>
            <button className="rounded border border-border px-1.5 py-1 text-xs text-foreground" type="button" aria-label={`Small size for ${widget.chart.name}`} onClick={() => onResize({ width: 3, height: 3 })}>S</button>
            <button className="rounded border border-border px-1.5 py-1 text-xs text-foreground" type="button" aria-label={`Medium size for ${widget.chart.name}`} onClick={() => onResize({ width: 6, height: 4 })}>M</button>
            <button className="rounded border border-border px-1.5 py-1 text-xs text-foreground" type="button" aria-label={`Large size for ${widget.chart.name}`} onClick={() => onResize({ width: 6, height: 6 })}>L</button>
            <button className="rounded border border-border px-1.5 py-1 text-xs text-foreground" type="button" aria-label={`Full width for ${widget.chart.name}`} onClick={() => onResize({ width: 12, height: 4 })}>Full</button>
            <Link className="rounded border border-border px-1.5 py-1 text-xs text-primary no-underline" to={`/charts/${widget.savedChartId}/edit`}>Edit chart</Link>
            <button className="rounded border border-border px-1.5 py-1 text-xs text-danger" type="button" onClick={onRemove}>Remove</button>
          </>}
          <button className="rounded border border-border px-1.5 py-1 text-xs text-foreground" type="button" aria-label={`Refresh ${widget.chart.name}`} onClick={() => void preview.refetch()}>↻</button>
        </div>
      </header>
      {preview.isError ? <div className="grid h-32 place-items-center rounded-lg border border-danger/40 bg-danger/10 p-3 text-center text-xs text-danger" role="alert">This chart could not load.<button className="underline" type="button" onClick={() => void preview.refetch()}>Retry</button></div>
        : <ChartPreviewCard preview={preview.data} type={widget.chart.chartType} options={widget.chart.options} compact />}
      {editMode && <span className="sr-only">Position {position + 1}; drag to reorder or use move buttons.</span>}
    </article>
  )
}
