import { describe, expect, it } from 'vitest'
import { formatDatasetValue } from './formatters'

describe('formatDatasetValue', () => {
  it('formats SQL dates without adding a time component', () => {
    expect(formatDatasetValue('2025-04-24T00:00:00', 'date')).toBe('2025-04-24')
    expect(formatDatasetValue('2025-04-24T13:15:00Z', 'datetime')).toBe('2025-04-24')
  })

  it('uses consistent number and boolean labels', () => {
    expect(formatDatasetValue(12345.5, 'decimal')).toBe('12,345.50')
    expect(formatDatasetValue(12345.5, 'integer')).toBe('12,346')
    expect(formatDatasetValue(false, 'boolean')).toBe('No')
  })
})
