import { useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartPreviewResponse, ChartType, ChartVisualOptions, DatasetAnalyticsResult } from '../../lib/api'
import { toCsv, transformChartData } from './chartUtils'

const palette = ['#39b7a4', '#7387ef', '#e4a95c', '#d9759d', '#72a9e8', '#9c7ddb', '#7ac58a', '#d47c61']
const chartText = 'rgb(var(--color-text))'
const mutedChartText = 'rgb(var(--color-text-muted))'
const chartBorder = 'rgb(var(--color-border))'
const raisedSurface = 'rgb(var(--color-surface-raised))'

export function ChartVisualization({
  result,
  type,
  options,
  compact = false,
  showTable = false,
  fillContainer = false,
  comparison,
}: {
  result: DatasetAnalyticsResult
  type: ChartType
  options: ChartVisualOptions
  compact?: boolean
  showTable?: boolean
  fillContainer?: boolean
  comparison?: ChartPreviewResponse['comparison']
}) {
  const data = transformChartData(type, result)
  const metrics = result.columns.filter(column => /^m\d+$/.test(column.key))
  const groups = result.columns.filter(column => column.key === 'groupValue' || /^groupValue\d+$/.test(column.key))
  const chartColors = options.colors?.length ? options.colors : palette
  const valueFormatter = (value: number | string) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return String(value)
    const style = options.numberFormat === 'currency' ? 'currency' : 'decimal'
    return new Intl.NumberFormat(undefined, {
      style,
      currency: options.numberFormat === 'currency' ? 'USD' : undefined,
      maximumFractionDigits: options.numberFormat === 'integer' ? 0 : 2,
      minimumFractionDigits: 0,
    }).format(numeric)
  }

  if (showTable || type === 'table') return <DataTable result={result} />
  if (type === 'kpi') {
    const first = data[0]
    return (
      <div className={`grid h-full content-center gap-2 text-center ${compact ? 'py-2' : 'min-h-48 py-6'}`}>
        <span className="text-sm text-muted">{options.title || metrics[0]?.label || 'Value'}</span>
        <strong className="text-4xl font-bold tabular-nums text-foreground">
          {valueFormatter(Number(first?.value ?? 0))}
        </strong>
        {comparison && <div className="flex items-center justify-center gap-2">
          {comparison.percentChange === null
            ? <span className="text-sm font-semibold text-muted">New · no previous-period baseline</span>
            : <span className={`text-sm font-semibold ${comparison.percentChange === 0 ? 'text-muted' : (comparison.percentChange > 0) === (options.goodDirection !== 'down') ? 'text-success' : 'text-danger'}`}>
              {comparison.percentChange > 0 ? '↑' : comparison.percentChange < 0 ? '↓' : '→'} {Math.abs(comparison.percentChange).toLocaleString(undefined, { maximumFractionDigits: 1 })}% vs previous period
            </span>}
          {comparison.previousValue !== null && <span className="text-xs text-muted">Prev. {valueFormatter(comparison.previousValue)}</span>}
        </div>}
        {comparison && <KpiSparkline values={comparison.sparkline} goodDirection={options.goodDirection ?? 'up'} />}
      </div>
    )
  }

  const height = fillContainer ? '100%' : compact ? 145 : 310
  const xKey = type === 'scatter' ? 'x' : 'name'
  const chart = type === 'pie' || type === 'donut'
    ? (
      <PieChart>
        <Tooltip formatter={value => valueFormatter(Number(value))} contentStyle={{ background: raisedSurface, borderColor: chartBorder, borderRadius: 10, color: chartText }} />
        {options.showLegend && <Legend wrapperStyle={{ color: chartText }} />}
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={type === 'donut' ? '52%' : 0} outerRadius="82%">
          {data.map((_, index) => <Cell key={`slice-${index}`} fill={chartColors[index % chartColors.length]} />)}
        </Pie>
      </PieChart>
    )
    : type === 'scatter'
      ? (
        <ScatterChart>
          <CartesianGrid stroke={chartBorder} strokeDasharray="3 3" />
          <XAxis dataKey={xKey} name={groups[0]?.label ?? 'X'} type="number" tick={{ fill: mutedChartText }} />
          <YAxis dataKey="y" name={metrics[0]?.label ?? 'Value'} tick={{ fill: mutedChartText }} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: raisedSurface, borderColor: chartBorder, borderRadius: 10, color: chartText }} />
          <Scatter data={data} fill={chartColors[0]} />
        </ScatterChart>
      )
      : type === 'line' || type === 'multi-line'
        ? (
          <LineChart data={data}>
            <CartesianGrid stroke={chartBorder} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} label={options.xAxisLabel ? { value: options.xAxisLabel, position: 'insideBottom', offset: -3, fill: mutedChartText } : undefined} tick={{ fill: mutedChartText }} />
            <YAxis label={options.yAxisLabel ? { value: options.yAxisLabel, angle: -90, position: 'insideLeft', fill: mutedChartText } : undefined} tick={{ fill: mutedChartText }} tickFormatter={valueFormatter} />
            <Tooltip formatter={value => valueFormatter(Number(value))} contentStyle={{ background: raisedSurface, borderColor: chartBorder, borderRadius: 10, color: chartText }} />
            {options.showLegend && <Legend wrapperStyle={{ color: chartText }} />}
            {metrics.map((metric, index) => <Line key={metric.key} type="monotone" dataKey={metric.key} name={metric.label} stroke={chartColors[index % chartColors.length]} strokeWidth={2} dot={false} />)}
          </LineChart>
        )
        : type === 'area' || type === 'stacked-area'
          ? (
            <AreaChart data={data}>
              <CartesianGrid stroke={chartBorder} strokeDasharray="3 3" />
              <XAxis dataKey={xKey} tick={{ fill: mutedChartText }} />
              <YAxis tick={{ fill: mutedChartText }} tickFormatter={valueFormatter} />
              <Tooltip formatter={value => valueFormatter(Number(value))} contentStyle={{ background: raisedSurface, borderColor: chartBorder, borderRadius: 10, color: chartText }} />
              {options.showLegend && <Legend wrapperStyle={{ color: chartText }} />}
              {metrics.map((metric, index) => <Area key={metric.key} type="monotone" dataKey={metric.key} name={metric.label} stroke={chartColors[index % chartColors.length]} fill={chartColors[index % chartColors.length]} fillOpacity={0.2} stackId={type === 'stacked-area' || options.stacked ? 'stack' : undefined} />)}
            </AreaChart>
          )
          : (
            <BarChart data={data} layout={type === 'horizontal-bar' ? 'vertical' : 'horizontal'}>
              <CartesianGrid stroke={chartBorder} strokeDasharray="3 3" />
              <XAxis dataKey={type === 'horizontal-bar' ? undefined : xKey} type={type === 'horizontal-bar' ? 'number' : 'category'} tick={{ fill: mutedChartText }} tickFormatter={type === 'horizontal-bar' ? valueFormatter : undefined} />
              <YAxis dataKey={type === 'horizontal-bar' ? xKey : undefined} type={type === 'horizontal-bar' ? 'category' : 'number'} tick={{ fill: mutedChartText }} tickFormatter={type === 'horizontal-bar' ? undefined : valueFormatter} width={type === 'horizontal-bar' ? undefined : 68} />
              <Tooltip formatter={value => valueFormatter(Number(value))} contentStyle={{ background: raisedSurface, borderColor: chartBorder, borderRadius: 10, color: chartText }} />
              {options.showLegend && <Legend wrapperStyle={{ color: chartText }} />}
              {metrics.map((metric, index) => <Bar key={metric.key} dataKey={metric.key} name={metric.label} fill={chartColors[index % chartColors.length]} stackId={type === 'stacked-bar' || options.stacked ? 'stack' : undefined} radius={[4, 4, 0, 0]} />)}
            </BarChart>
          )

  return (
    <figure className={`m-0 min-w-0 ${fillContainer ? 'h-full' : ''}`}>
      {options.title && !compact && <figcaption className="mb-2 text-center font-semibold text-foreground">{options.title}</figcaption>}
      <div className={`min-w-0 ${fillContainer ? 'h-full' : ''}`} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
    </figure>
  )
}

function DataTable({ result }: { result: DatasetAnalyticsResult }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
      <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
        <thead className="sticky top-0 bg-surface-raised">
          <tr>{result.columns.map(column => <th className="border-b border-border px-3 py-2 font-semibold text-foreground" key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr className={rowIndex % 2 ? 'bg-surface-raised/50' : 'bg-surface'} key={rowIndex}>
              {result.columns.map(column => <td className="border-b border-border/60 px-3 py-2 text-foreground" key={column.key}>{String(row[column.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ChartPreviewCard({
  preview,
  type,
  options,
  compact = false,
  fillContainer = false,
}: {
  preview: ChartPreviewResponse | undefined
  type: ChartType
  options: ChartVisualOptions
  compact?: boolean
  fillContainer?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tableMode, setTableMode] = useState(false)
  if (!preview) return <div className={`grid place-items-center rounded-lg border border-border bg-surface-raised text-sm text-muted ${compact ? 'h-36' : 'h-[320px]'}`} role="status">Building preview…</div>

  const downloadCsv = () => {
    const file = new Blob([toCsv(preview.result)], { type: 'text/csv;charset=utf-8' })
    downloadBlob(file, `${options.title || 'chart-data'}.csv`)
  }
  const downloadPng = async () => {
    const svg = containerRef.current?.querySelector('svg.recharts-surface')
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const source = new XMLSerializer().serializeToString(clone)
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not render the chart image.'))
    })
    const canvas = document.createElement('canvas')
    canvas.width = svg.clientWidth * 2
    canvas.height = svg.clientHeight * 2
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas export is not available in this browser.')
    context.scale(2, 2)
    context.drawImage(image, 0, 0)
    canvas.toBlob(blob => { if (blob) downloadBlob(blob, `${options.title || 'chart'}.png`) })
  }

  return (
    <div className={`min-w-0 ${fillContainer ? 'h-full' : ''}`} ref={containerRef}>
      {!compact && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold text-primary">Cache {preview.cacheStatus}</span>
            <span>{preview.durationMilliseconds.toFixed(1)} ms</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground" type="button" onClick={() => setTableMode(current => !current)} aria-pressed={tableMode}>{tableMode ? 'View chart' : 'View as table'}</button>
            <button className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground" type="button" onClick={downloadCsv}>Download CSV</button>
            <button className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-foreground" type="button" onClick={() => void downloadPng()}>Download PNG</button>
          </div>
        </div>
      )}
      <ChartVisualization result={preview.result} type={type} options={options} compact={compact} showTable={tableMode} fillContainer={fillContainer} comparison={preview.comparison} />
    </div>
  )
}

function KpiSparkline({ values, goodDirection }: { values: number[]; goodDirection: 'up' | 'down' }) {
  if (values.length < 2) return null
  const minimum = Math.min(...values)
  const range = Math.max(...values) - minimum || 1
  const points = values.map((value, index) =>
    `${(index / (values.length - 1)) * 96 + 2},${24 - ((value - minimum) / range) * 20}`,
  ).join(' ')
  const isUp = values.at(-1)! >= values[0]!
  const positive = isUp === (goodDirection === 'up')
  return <svg className={`mx-auto h-7 w-28 ${positive ? 'text-success' : 'text-danger'}`} viewBox="0 0 100 28" role="img" aria-label="Daily KPI trend">
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
