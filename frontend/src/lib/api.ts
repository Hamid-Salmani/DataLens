import type { paths } from './openapi.generated'

export type OpenApiPaths = paths

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'
const configuredUploadLimit = Number(import.meta.env.VITE_MAX_UPLOAD_BYTES)
export const MAX_CSV_UPLOAD_BYTES = Number.isSafeInteger(configuredUploadLimit) && configuredUploadLimit > 0
  ? configuredUploadLimit
  : 200 * 1024 * 1024

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
}

export interface AuthResponse {
  accessToken: string
  user: User
}

export interface DatasetColumn {
  position: number
  name: string
  typeName: 'integer' | 'decimal' | 'number' | 'date' | 'datetime' | 'boolean' | 'text'
  isNullable: boolean
}

export interface Dataset {
  id: string
  name: string
  fileName: string
  rowCount: number
  skippedRows: number
  createdAt: string
  columnCount?: number
  columns?: DatasetColumn[]
}

export interface DashboardSummary {
  datasetCount: number
  totalRows: number
  latestDataset: Pick<Dataset, 'id' | 'name' | 'createdAt' | 'rowCount'> | null
}

export interface DatasetPreview {
  datasetId: string
  totalRows: number
  page: number
  pageSize: number
  rows: Array<Record<string, string | number | boolean | null>>
}

export interface DatasetUploadResult {
  jobId: string
  datasetId: string
}

export interface ImportJobStatus {
  jobId: string
  datasetId: string
  datasetName: string
  status: 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Cancelled'
  progress: number
  rowsProcessed: number
  rowsSkipped: number
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface DatasetAnalyticsRequest {
  groupByPosition?: number | null
  metrics: Array<{ function: string; columnPosition: number | null }>
  filters: Array<{ columnPosition: number; operator: string; value: string | null }>
  topN: number
  groupByPositions?: number[]
  sortBy?: string | null
  sortDirection?: 'asc' | 'desc'
  timeBucketPosition?: number | null
  timeBucket?: 'day' | 'week' | 'month' | 'quarter' | 'year' | null
  comparisonDatePosition?: number | null
}

export interface DatasetAnalyticsResult {
  columns: Array<{ key: string; label: string; typeName: DatasetColumn['typeName'] }>
  rows: Array<Record<string, string | number | boolean | null>>
}

export interface SavedReport {
  id: string
  datasetId: string
  name: string
  chartType: string
  query: DatasetAnalyticsRequest
  createdAt: string
  updatedAt: string
}

export const chartTypes = [
  'bar', 'horizontal-bar', 'stacked-bar', 'line', 'multi-line', 'area', 'stacked-area',
  'pie', 'donut', 'scatter', 'kpi', 'table',
] as const
export type ChartType = typeof chartTypes[number]

export interface ChartVisualOptions {
  title?: string | null
  xAxisLabel?: string | null
  yAxisLabel?: string | null
  showLegend: boolean
  stacked: boolean
  colors?: string[] | null
  numberFormat: 'auto' | 'number' | 'integer' | 'percent' | 'currency'
  goodDirection?: 'up' | 'down'
}

export interface SavedChart {
  id: string
  datasetId: string
  datasetName: string
  name: string
  description: string
  chartType: ChartType
  query: DatasetAnalyticsRequest
  options: ChartVisualOptions
  createdAt: string
  updatedAt: string
  version: string
}

export interface ChartPreviewResponse {
  result: DatasetAnalyticsResult
  cacheStatus: 'HIT' | 'MISS'
  durationMilliseconds: number
  dateFilterApplicable?: boolean
  comparison?: {
    previousValue: number | null
    percentChange: number | null
    sparkline: number[]
  } | null
}

export interface DashboardWidget {
  id: string
  savedChartId: string
  x: number
  y: number
  width: number
  height: number
  titleOverride: string | null
  chart: SavedChart
}

export interface Dashboard {
  id: string
  name: string
  isDefault: boolean
  widgets: DashboardWidget[]
  version: string
}

export interface ExportJob {
  id: string
  datasetId: string | null
  datasetName: string
  targetName: string
  fileName: string
  type: 'DatasetCsv' | 'ChartPdf' | 'DashboardPdf'
  status: 'Queued' | 'Running' | 'Completed' | 'Failed'
  progress: number
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface ImportErrorItem {
  rowNumber: number
  columnName: string | null
  rawValue: string | null
  reason: string
}

export interface ImportErrorPage {
  page: number
  pageSize: number
  rowsSkipped: number
  totalErrors: number
  errors: ImportErrorItem[]
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const identityErrors: Record<string, string> = {
  DuplicateEmail: 'An account with this email already exists. Try signing in instead.',
  InvalidEmail: 'Enter a valid email address.',
  PasswordRequiresDigit: 'Add at least one number to your password.',
  PasswordRequiresLower: 'Add at least one lowercase letter to your password.',
  PasswordRequiresNonAlphanumeric: 'Add at least one symbol to your password.',
  PasswordRequiresUpper: 'Add at least one uppercase letter to your password.',
  PasswordTooShort: 'Use at least 10 characters for your password.',
}

function getApiErrorMessage(
  body: { detail?: string; title?: string; errors?: Record<string, string[]> } | null,
  status: number,
) {
  if ([0, 502, 503, 504].includes(status)) {
    return 'The DataLens API is unavailable. Start the backend, then try again.'
  }
  if (status === 429) return 'Too many attempts. Please wait a minute and try again.'
  if (status === 401) return 'The email or password is incorrect.'
  if (status === 413) return 'This CSV is over the 200 MB upload limit.'

  if (body?.errors) {
    const messages = Object.entries(body.errors).flatMap(([code, details]) => {
      const friendly = identityErrors[code]
      return friendly ? [friendly] : details
    })
    if (messages.length > 0) return [...new Set(messages)].join(' ')
  }

  return body?.detail ?? body?.title ?? 'Something went wrong. Please try again.'
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('datalens.accessToken')
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(getApiErrorMessage(null, 0), 0)
  }
  if (response.status === 204) return undefined as T

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const problem = body as { detail?: string; title?: string; errors?: Record<string, string[]> } | null
    throw new ApiError(getApiErrorMessage(problem, response.status), response.status)
  }
  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), signal }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path: string, body?: unknown) => request<void>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) }),
  upload: (file: File, name: string, onProgress: (progress: number) => void) =>
    new Promise<DatasetUploadResult>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('POST', `${apiBaseUrl}/datasets`)
      const token = sessionStorage.getItem('datalens.accessToken')
      if (token) request.setRequestHeader('Authorization', `Bearer ${token}`)
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      })
      request.addEventListener('load', () => {
        let body: unknown = null
        try {
          body = JSON.parse(request.responseText || 'null')
        } catch {
          reject(new ApiError('The API returned an unreadable response.', request.status))
          return
        }
        if (request.status >= 200 && request.status < 300) {
          resolve(body as DatasetUploadResult)
          return
        }
        const problem = body as { detail?: string; title?: string; errors?: Record<string, string[]> } | null
        reject(new ApiError(getApiErrorMessage(problem, request.status), request.status))
      })
      request.addEventListener('error', () => reject(new ApiError('Could not reach the DataLens API.', 0)))

      const form = new FormData()
      form.append('file', file)
      form.append('name', name)
      request.send(form)
    }),
  cancelImport: (jobId: string) => request<ImportJobStatus>(`/import-jobs/${jobId}/cancel`, { method: 'POST' }),
  retryImport: (jobId: string) => request<ImportJobStatus>(`/import-jobs/${jobId}/retry`, { method: 'POST' }),
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch('/health')
    return response.ok
  } catch {
    return false
  }
}

export async function downloadImportErrorsCsv(datasetId: string): Promise<void> {
  const headers = new Headers()
  const token = sessionStorage.getItem('datalens.accessToken')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/datasets/${datasetId}/import-errors.csv`, { headers })
  } catch {
    throw new ApiError(getApiErrorMessage(null, 0), 0)
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(
      getApiErrorMessage(body as { detail?: string; title?: string; errors?: Record<string, string[]> } | null, response.status),
      response.status,
    )
  }

  const downloadUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = `import-errors-${datasetId}.csv`
  link.click()
  URL.revokeObjectURL(downloadUrl)
}

export async function downloadExportFile(job: ExportJob): Promise<void> {
  const headers = new Headers()
  const token = sessionStorage.getItem('datalens.accessToken')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/exports/${job.id}/download`, { headers })
  } catch {
    throw new ApiError(getApiErrorMessage(null, 0), 0)
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(
      getApiErrorMessage(body as { detail?: string; title?: string; errors?: Record<string, string[]> } | null, response.status),
      response.status,
    )
  }
  const downloadUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = job.fileName
  link.click()
  URL.revokeObjectURL(downloadUrl)
}
