import type { ChartType, DatasetAnalyticsRequest, DatasetAnalyticsResult } from '../../lib/api'

export interface ChartConfig {
  name: string
  description: string
  datasetId: string
  chartType: ChartType
  query: DatasetAnalyticsRequest
  options: {
    title: string
    xAxisLabel: string
    yAxisLabel: string
    showLegend: boolean
    stacked: boolean
    colors: string[]
    numberFormat: 'auto' | 'number' | 'integer' | 'percent' | 'currency'
    goodDirection: 'up' | 'down'
  }
}

export type ChartDatum = Record<string, string | number | boolean | null>

export const chartPalettes = {
  ocean: ['#39b7a4', '#7387ef', '#e4a95c', '#d9759d', '#72a9e8', '#9c7ddb', '#7ac58a', '#d47c61'],
  vivid: ['#007f87', '#e4572e', '#f3a712', '#7b2cbf', '#2a9d8f', '#d1495b', '#4d908e', '#577590'],
  earth: ['#4f772d', '#90a955', '#ec9a29', '#bc4b51', '#386641', '#a7c957', '#6c584c', '#dda15e'],
} as const

export const defaultChartConfig = (datasetId = ''): ChartConfig => ({
  name: 'Untitled chart',
  description: '',
  datasetId,
  chartType: 'bar',
  query: {
    groupByPosition: null,
    groupByPositions: [],
    metrics: [{ function: 'count', columnPosition: null }],
    filters: [],
    topN: 50,
    sortBy: 'm0',
    sortDirection: 'desc',
  },
  options: {
    title: '',
    xAxisLabel: '',
    yAxisLabel: '',
    showLegend: true,
    stacked: false,
    colors: [...chartPalettes.ocean],
    numberFormat: 'auto',
    goodDirection: 'up',
  },
})

export function serializeChartConfig(config: ChartConfig): string {
  return new URLSearchParams({ config: JSON.stringify(config) }).toString()
}

export function deserializeChartConfig(search: string, fallback = defaultChartConfig()): ChartConfig {
  const encoded = new URLSearchParams(search).get('config')
  if (!encoded) return fallback
  try {
    const parsed: unknown = JSON.parse(encoded)
    if (!isChartConfig(parsed)) return fallback
    return parsed
  } catch {
    return fallback
  }
}

function isChartConfig(value: unknown): value is ChartConfig {
  if (typeof value !== 'object' || value === null) return false
  const config = value as Partial<ChartConfig>
  return typeof config.name === 'string'
    && typeof config.datasetId === 'string'
    && typeof config.chartType === 'string'
    && typeof config.query === 'object'
    && config.query !== null
    && typeof config.options === 'object'
    && config.options !== null
}

export function transformChartData(type: ChartType, result: DatasetAnalyticsResult): ChartDatum[] {
  const groupColumns = result.columns.filter(column => column.key === 'groupValue' || /^groupValue\d+$/.test(column.key))
  const metrics = result.columns.filter(column => /^m\d+$/.test(column.key))
  const values = result.rows.map(row => {
    const groups = groupColumns.map(column => row[column.key] ?? null)
    const datum: ChartDatum = { name: groups.filter(value => value !== null).join(' · ') || 'All rows' }
    for (const metric of metrics) datum[metric.key] = toChartValue(row[metric.key])
    return { datum, groups, row }
  })

  if (type === 'table') return result.rows as ChartDatum[]
  if (type === 'pie' || type === 'donut') {
    return values.map(({ datum, row }) => ({ name: datum.name ?? 'All rows', value: toChartValue(row[metrics[0]?.key ?? 'm0']) }))
  }
  if (type === 'scatter') {
    return values.map(({ groups, row }) => ({
      name: String(groups[0] ?? 'All rows'),
      x: toChartValue(groups[0] ?? row[metrics[0]?.key ?? 'm0']),
      y: toChartValue(row[metrics[0]?.key ?? 'm0']),
      z: toChartValue(row[metrics[1]?.key ?? 'm0']),
    }))
  }
  if (type === 'kpi') {
    const current = toChartValue(result.rows[0]?.[metrics[0]?.key ?? 'm0'])
    const previous = toChartValue(result.rows[0]?.[`previous_${metrics[0]?.key ?? 'm0'}`])
    return [{ value: current, previous, name: 'Value' }]
  }
  return values.map(({ datum }) => datum)
}

function toChartValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
    const date = Date.parse(value)
    return Number.isFinite(date) ? date : null
  }
  return null
}

export function toCsv(result: DatasetAnalyticsResult): string {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return [
    result.columns.map(column => quote(column.label)).join(','),
    ...result.rows.map(row => result.columns.map(column => quote(row[column.key])).join(',')),
  ].join('\r\n')
}
