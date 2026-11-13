import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ResponsiveGridLayout, useContainerWidth, type Layout } from 'react-grid-layout'
import { Select } from '../../components/Select'
import { PageContainer, PageHeader } from '../../components/AppLayout'
import {
  api,
  type ChartPreviewResponse,
  type Dashboard,
  type DashboardWidget,
  type ExportJob,
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
const BREAKPOINTS = { lg: 1100, md: 768, sm: 480, xs: 0 }
const GRID_COLUMNS = { lg: 12, md: 8, sm: 4, xs: 1 }
const DATE_RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
]
const REFRESH_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '300', label: '5 minutes' },
]

interface DashboardDateRange {
  from: string
  to: string
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function rangeForPreset(preset: string, today = new Date()): DashboardDateRange {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (preset === 'this-month') return { from: dateInputValue(new Date(end.getFullYear(), end.getMonth(), 1)), to: dateInputValue(end) }
  if (preset === 'last-month') return {
    from: dateInputValue(new Date(end.getFullYear(), end.getMonth() - 1, 1)),
    to: dateInputValue(new Date(end.getFullYear(), end.getMonth(), 0)),
  }
  const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  return { from: dateInputValue(start), to: dateInputValue(end) }
}

function toGridLayout(widgets: DashboardWidget[], columns: number): Layout {
  const scale = columns / 12
  return widgets.map(widget => ({
    i: widget.id,
    x: Math.max(0, Math.round(widget.x * scale)),
    y: widget.y,
    w: Math.max(1, Math.min(columns, Math.round(widget.width * scale))),
    h: widget.height,
    minW: 1,
    minH: 2,
  }))
}

function fromGridLayout(widgets: DashboardWidget[], grid: Layout, columns: number): DashboardWidget[] {
  const scale = 12 / columns
  return widgets.map(widget => {
    const item = grid.find(candidate => candidate.i === widget.id)
    if (!item) return widget
    return {
      ...widget,
      x: Math.round(item.x * scale),
      y: item.y,
      width: Math.max(1, Math.min(12, Math.round(item.w * scale))),
      height: item.h,
    }
  })
}

export function DashboardHomePage() {
  const [selectedId, setSelectedId] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [layoutOverride, setLayoutOverride] = useState<DashboardWidget[] | null>(null)
  const [saveMessage, setSaveMessage] = useState('Saved')
  const [error, setError] = useState('')
  const [toastMessage, setToastMessage] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [layoutReadyToSave, setLayoutReadyToSave] = useState(false)
  const [showChartPicker, setShowChartPicker] = useState(false)
  const [chartSearch, setChartSearch] = useState('')
  const [newDashboardName, setNewDashboardName] = useState('')
  const [gridColumns, setGridColumns] = useState(12)
  const [searchParams, setSearchParams] = useSearchParams()
  const [autoRefresh, setAutoRefresh] = useState('off')
  const [lastUpdated, setLastUpdated] = useState(() => Date.now())
  const [refreshCountdownState, setRefreshCountdownState] = useState<{ interval: string; seconds: number } | null>(null)
  const { width: gridWidth, containerRef, mounted: gridMounted, measureWidth } = useContainerWidth({ measureBeforeMount: true })
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
  const rangePreset = searchParams.get('range') ?? '30d'
  const fallbackRange = useMemo(() => rangeForPreset(rangePreset), [rangePreset])
  const dateRange = useMemo<DashboardDateRange>(() => ({
    from: searchParams.get('from') ?? fallbackRange.from,
    to: searchParams.get('to') ?? fallbackRange.to,
  }), [fallbackRange.from, fallbackRange.to, searchParams])
  const rangeKey = `${dateRange.from}:${dateRange.to}`
  const refreshCountdown = autoRefresh === 'off'
    ? null
    : refreshCountdownState?.interval === autoRefresh
      ? refreshCountdownState.seconds
      : Number(autoRefresh)

  useEffect(() => {
    if (searchParams.has('range')) return
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.set('range', rangePreset)
      next.set('from', dateRange.from)
      next.set('to', dateRange.to)
      return next
    }, { replace: true })
  }, [dateRange.from, dateRange.to, rangePreset, searchParams, setSearchParams])

  const chooseDateRange = (preset: string) => {
    const computed = preset === 'custom' ? dateRange : rangeForPreset(preset)
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.set('range', preset)
      next.set('from', computed.from)
      next.set('to', computed.to)
      return next
    }, { replace: true })
  }

  const setCustomDate = (key: 'from' | 'to', value: string) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.set('range', 'custom')
      next.set(key, value)
      return next
    }, { replace: true })
  }

  const refreshAll = async () => {
    await queryClient.refetchQueries({ queryKey: ['dashboard-widget-chart'] })
    setLastUpdated(Date.now())
  }

  const exportDashboardPdf = async () => {
    if (!currentDashboard) return
    try {
      await api.post<ExportJob>(`/exports/dashboards/${currentDashboard.id}`, {
        from: dateRange.from,
        to: dateRange.to,
      })
      setToastMessage('Dashboard PDF queued. View it in Exports.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the dashboard PDF export.')
    }
  }

  useEffect(() => {
    if (currentDashboard) measureWidth()
  }, [currentDashboard, measureWidth])

  useEffect(() => {
    if (autoRefresh === 'off') return
    const intervalSeconds = Number(autoRefresh)
    let remaining = intervalSeconds
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      remaining -= 1
      setRefreshCountdownState({ interval: autoRefresh, seconds: remaining })
      if (remaining <= 0) {
        remaining = intervalSeconds
        setRefreshCountdownState({ interval: autoRefresh, seconds: remaining })
        void queryClient.refetchQueries({ queryKey: ['dashboard-widget-chart'] })
          .then(() => setLastUpdated(Date.now()))
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, queryClient, rangeKey])

  useEffect(() => {
    if (!dirty || !layoutReadyToSave || !currentDashboard) return
    const timer = window.setTimeout(() => {
      setSaveMessage('Saving…')
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
          setLayoutReadyToSave(false)
          setSaveMessage('Saved')
        })
        .catch(async cause => {
          const conflict = cause instanceof Error && 'status' in cause && cause.status === 409
          if (conflict) {
            setToastMessage('Another session changed this dashboard. The latest layout was reloaded.')
            window.setTimeout(() => setToastMessage(''), 5000)
          } else {
            setError(cause instanceof Error ? cause.message : 'Could not save dashboard layout.')
          }
          setSaveMessage('Save failed')
          setLayoutOverride(null)
          setLayoutReadyToSave(false)
          await refetchDashboard()
        })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [dirty, layoutReadyToSave, layout, currentDashboard, queryClient, refetchDashboard])

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
    setLayoutReadyToSave(true)
    setSaveMessage('Unsaved changes')
  }

  const moveWidget = (widget: DashboardWidget, direction: -1 | 1) => {
    const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
    const index = ordered.findIndex(item => item.id === widget.id)
    const target = ordered[index + direction]
    if (!target) return
    const currentPosition = { x: widget.x, y: widget.y }
    setLayoutOverride(current => (current ?? layout).map(item => item.id === widget.id
      ? { ...item, x: target.x, y: target.y }
      : item.id === target.id ? { ...item, ...currentPosition } : item))
    setLayoutReadyToSave(true)
    setSaveMessage('Unsaved changes')
    setAnnouncement(`${widget.chart.name} moved ${direction < 0 ? 'up' : 'down'}.`)
  }

  const acceptGridLayout = (next: Layout) => {
    if (!currentDashboard) return
    setLayoutOverride(fromGridLayout(layout, next, gridColumns))
    setLayoutReadyToSave(true)
    setSaveMessage('Unsaved changes')
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
    <PageContainer>
      <PageHeader eyebrow="Your analytics" title="Dashboard" description="Charts and insights across your datasets."
        actions={<div className="flex flex-wrap items-end gap-2">
          {dashboards.length > 0 && <label className="grid min-w-48 gap-1 text-xs font-semibold text-muted">Dashboard
            <Select label="Dashboard" value={activeDashboardId} options={dashboards.map(item => ({
              value: item.id,
              label: `${item.name}${item.isDefault ? ' · Default' : ''}`,
              description: `${item.widgets.length} ${item.widgets.length === 1 ? 'chart' : 'charts'}`,
            }))} onChange={id => { setSelectedId(id); setLayoutOverride(null) }} />
          </label>}
          <label className="grid gap-1 text-xs font-semibold text-muted">New board<input className="min-h-10 rounded-lg border border-border bg-surface px-3 text-foreground" value={newDashboardName} onChange={event => setNewDashboardName(event.target.value)} placeholder="Board name" /></label>
          <button className="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-background" type="button" disabled={!newDashboardName.trim()} onClick={() => void createDashboard()}>Create</button>
        </div>} />

      {error && <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert">{error}<button className="underline" type="button" onClick={() => setError('')}>Dismiss</button></div>}
      {dashboardList.isError && <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-danger" role="alert">Could not load dashboards. <button className="underline" type="button" onClick={() => void dashboardList.refetch()}>Retry</button></div>}
      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3" aria-label="Dashboard controls">
        <label className="grid min-w-44 gap-1 text-xs font-semibold text-muted">Date range
          <Select label="Dashboard date range" value={rangePreset} options={DATE_RANGE_OPTIONS} onChange={chooseDateRange} />
        </label>
        {rangePreset === 'custom' && <>
          <label className="grid gap-1 text-xs font-semibold text-muted">From<input aria-label="Custom range start" className="min-h-10 rounded-lg border border-border bg-surface-raised px-2 text-foreground" type="date" value={dateRange.from} onChange={event => setCustomDate('from', event.target.value)} /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted">To<input aria-label="Custom range end" className="min-h-10 rounded-lg border border-border bg-surface-raised px-2 text-foreground" type="date" value={dateRange.to} onChange={event => setCustomDate('to', event.target.value)} /></label>
        </>}
        <label className="grid min-w-36 gap-1 text-xs font-semibold text-muted">Auto-refresh
          <Select label="Auto-refresh" value={autoRefresh} options={REFRESH_OPTIONS} onChange={setAutoRefresh} />
        </label>
        <button className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-sm font-semibold text-foreground" type="button" onClick={() => void refreshAll()}>Refresh all</button>
        <span className="text-xs text-muted" aria-live="polite">
          Updated {new Date(lastUpdated).toLocaleTimeString()}
          {refreshCountdown !== null ? ` · Refresh in ${refreshCountdown}s` : ''}
        </span>
      </section>
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
                <button className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground" type="button" onClick={() => void exportDashboardPdf()}>Export PDF</button>
                <button className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground" type="button" onClick={() => void document.documentElement.requestFullscreen?.()}>Present</button>
              </div>
            </div>
            {layout.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center"><h2 className="text-xl font-semibold text-foreground">No charts on this dashboard yet</h2><p className="mt-2 text-muted">Add an existing chart or create a new one to get started.</p><div className="mt-4 flex justify-center gap-2"><button className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-background" type="button" onClick={() => { setChartSearch(''); setShowChartPicker(true) }}>Add chart</button><Link className="rounded-lg border border-border px-4 py-2.5 font-semibold text-foreground no-underline" to="/charts/new">Create chart</Link></div></div>
              : <div ref={containerRef as RefObject<HTMLDivElement>} data-grid-columns={gridColumns} className={`dashboard-grid-wrap ${editMode ? 'is-editing' : ''}`} aria-label={`${currentDashboard.name} charts`}>
                {gridMounted && <ResponsiveGridLayout
                  width={gridWidth}
                  breakpoints={BREAKPOINTS}
                  cols={GRID_COLUMNS}
                  layouts={Object.fromEntries(Object.entries(GRID_COLUMNS).map(([name, cols]) => [name, toGridLayout(layout, cols)]))}
                  rowHeight={72}
                  margin={[12, 12]}
                  containerPadding={[0, 0]}
                  dragConfig={{ enabled: editMode, handle: '.dashboard-widget-drag-handle', cancel: '.no-drag,button,a,summary', allowMobileScroll: true }}
                  resizeConfig={{ enabled: editMode, handles: ['s', 'e', 'se'] }}
                  onBreakpointChange={(_breakpoint, cols) => setGridColumns(cols)}
                  onDragStop={currentLayout => acceptGridLayout(currentLayout)}
                  onResizeStop={currentLayout => acceptGridLayout(currentLayout)}
                >
                  {layout.map((widget, index) => <div key={widget.id} className="dashboard-grid-item">
                    <DashboardChartWidget
                      widget={widget}
                      editMode={editMode}
                      dateRange={dateRange}
                      onResize={size => {
                        updateWidget(widget.id, size)
                        setAnnouncement(`${widget.chart.name} size updated.`)
                      }}
                      onRemove={() => void removeWidget(widget)}
                      onMove={direction => moveWidget(widget, direction)}
                      position={index}
                    />
                  </div>)}
                </ResponsiveGridLayout>}
                <p className="sr-only" aria-live="polite">{announcement}</p>
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
      {toastMessage && <div className="fixed bottom-5 right-5 z-[70] max-w-sm rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground shadow-xl" role="status">{toastMessage}</div>}
    </PageContainer>
  )
}

function DashboardChartWidget({
  widget,
  editMode,
  dateRange,
  onResize,
  onRemove,
  onMove,
  position,
}: {
  widget: DashboardWidget
  editMode: boolean
  dateRange: DashboardDateRange
  onResize: (size: Pick<DashboardWidget, 'width' | 'height'>) => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
  position: number
}) {
  const preview = useQuery({
    queryKey: ['dashboard-widget-chart', widget.savedChartId, dateRange.from, dateRange.to],
    queryFn: () => api.get<ChartPreviewResponse>(`/charts/${widget.savedChartId}/preview?from=${encodeURIComponent(dateRange.from)}&to=${encodeURIComponent(dateRange.to)}`),
    refetchOnWindowFocus: false,
  })
  return (
    <article
      className={`flex h-full min-w-0 flex-col overflow-hidden rounded-xl border ${editMode ? 'border-dashed border-primary/70' : 'border-border'} bg-surface p-3`}
      aria-label={`${widget.titleOverride || widget.chart.name} chart widget`}
    >
      <header className={`dashboard-widget-drag-handle mb-2 flex shrink-0 flex-wrap items-start justify-between gap-2 ${editMode ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}>
        <div className="min-w-0"><h2 className="m-0 truncate text-sm font-semibold text-foreground">{widget.titleOverride || widget.chart.options.title || widget.chart.name}</h2><p className="mt-0.5 truncate text-xs text-muted">{widget.chart.datasetName}</p></div>
        <div className="flex flex-wrap items-center gap-1">
          {preview.data && !preview.data.dateFilterApplicable && <span className="rounded bg-surface-raised px-1.5 py-1 text-[10px] text-muted" title="This dataset has no date column">Filter not applicable</span>}
          {editMode && <details className="no-drag relative">
            <summary className="cursor-pointer rounded border border-border px-2 py-1 text-xs text-foreground">Widget menu</summary>
            <div className="absolute right-0 top-full z-20 mt-1 grid min-w-40 gap-1 rounded-lg border border-border bg-surface p-2 shadow-xl">
              <button className="rounded px-2 py-1 text-left text-xs hover:bg-surface-raised" type="button" onClick={() => onMove(-1)}>Move up</button>
              <button className="rounded px-2 py-1 text-left text-xs hover:bg-surface-raised" type="button" onClick={() => onMove(1)}>Move down</button>
              <button className="rounded px-2 py-1 text-left text-xs hover:bg-surface-raised" type="button" onClick={() => onResize({ width: 3, height: 3 })}>Size S</button>
              <button className="rounded px-2 py-1 text-left text-xs hover:bg-surface-raised" type="button" onClick={() => onResize({ width: 6, height: 4 })}>Size M</button>
              <button className="rounded px-2 py-1 text-left text-xs hover:bg-surface-raised" type="button" onClick={() => onResize({ width: 6, height: 6 })}>Size L</button>
              <button className="rounded px-2 py-1 text-left text-xs hover:bg-surface-raised" type="button" onClick={() => onResize({ width: 12, height: 4 })}>Full width</button>
            </div>
          </details>}
          {editMode && <>
            <Link className="rounded border border-border px-1.5 py-1 text-xs text-primary no-underline" to={`/charts/${widget.savedChartId}/edit`}>Edit chart</Link>
            <button className="no-drag rounded border border-border px-1.5 py-1 text-xs text-danger" type="button" onClick={onRemove}>Remove</button>
          </>}
          <button className="no-drag rounded border border-border px-1.5 py-1 text-xs text-foreground" type="button" aria-label={`Refresh ${widget.chart.name}`} onClick={() => void preview.refetch()}>↻</button>
        </div>
      </header>
      {preview.isError ? <div className="grid h-32 place-items-center rounded-lg border border-danger/40 bg-danger/10 p-3 text-center text-xs text-danger" role="alert">This chart could not load.<button className="underline" type="button" onClick={() => void preview.refetch()}>Retry</button></div>
        : <div className="min-h-0 flex-1"><ChartPreviewCard preview={preview.data} type={widget.chart.chartType} options={widget.chart.options} compact fillContainer /></div>}
      {editMode && <span className="sr-only">Position {position + 1}; drag to reorder or use move buttons.</span>}
    </article>
  )
}
