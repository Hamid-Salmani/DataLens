import { describe, expect, it } from 'vitest'
import { chartTypes, type DatasetAnalyticsResult } from '../../lib/api'
import { defaultChartConfig, deserializeChartConfig, serializeChartConfig, toCsv, transformChartData } from './chartUtils'

const sample: DatasetAnalyticsResult = {
  columns: [
    { key: 'groupValue', label: 'Month', typeName: 'date' },
    { key: 'groupValue1', label: 'Region', typeName: 'text' },
    { key: 'm0', label: 'SUM(Revenue)', typeName: 'decimal' },
    { key: 'm1', label: 'COUNT(*)', typeName: 'integer' },
  ],
  rows: [
    { groupValue: '2025-01-01', groupValue1: 'West', m0: 24.5, m1: 2 },
    { groupValue: '2025-01-01', groupValue1: 'East', m0: '10.5', m1: 1 },
  ],
}

describe('chart configuration and data transforms', () => {
  it('round-trips an editor config through URL search params', () => {
    const config = defaultChartConfig('dataset-1')
    config.query.metrics = [{ function: 'sum', columnPosition: 3 }, { function: 'count', columnPosition: null }]
    config.chartType = 'multi-line'
    const serialized = serializeChartConfig(config)
    expect(deserializeChartConfig(`?${serialized}`)).toEqual(config)
    expect(deserializeChartConfig('?config=bad-json')).toEqual(defaultChartConfig())
  })

  it.each(chartTypes)('returns a serializable transform for %s charts', chartType => {
    const transformed = transformChartData(chartType, sample)
    expect(transformed.length).toBeGreaterThan(0)
    expect(() => JSON.stringify(transformed)).not.toThrow()
    if (chartType === 'pie' || chartType === 'donut') expect(transformed[0]).toEqual({ name: '2025-01-01 · West', value: 24.5 })
    if (chartType === 'scatter') expect(transformed[0]).toMatchObject({ x: Date.parse('2025-01-01'), y: 24.5, z: 2 })
    if (chartType === 'kpi') expect(transformed[0]).toMatchObject({ value: 24.5, name: 'Value' })
  })

  it('escapes data and headers when exporting chart data as CSV', () => {
    expect(toCsv({ columns: [{ key: 'x', label: 'A,B', typeName: 'text' }], rows: [{ x: 'say "hi"' }] }))
      .toBe('"A,B"\r\n"say ""hi"""')
  })
})
