import type { DatasetColumn } from './api'

export function formatDatasetValue(
  value: string | number | boolean | null | undefined,
  typeName: DatasetColumn['typeName'],
): string {
  if (value === null || value === undefined) return '—'
  if (typeName === 'boolean' || typeof value === 'boolean') return value === true || value === 'true' ? 'Yes' : 'No'

  if (typeName === 'date' || typeName === 'datetime') {
    const isoDate = /^(\d{4}-\d{2}-\d{2})/.exec(String(value))
    if (isoDate) return isoDate[1] ?? String(value).slice(0, 10)
  }

  if (typeName === 'integer' || typeName === 'decimal' || typeName === 'number') {
    const number = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(number)) {
      const digits = typeName === 'integer' ? 0 : 2
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(number)
    }
  }

  return String(value)
}
