import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../theme'
import { ChartEditorPage } from './ChartPages'

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: { ...actual.api, ...apiMocks } }
})

vi.mock('./ChartVisualization', () => ({ ChartPreviewCard: () => null }))

const datasetId = '11111111-1111-4111-8111-111111111111'
const dataset = {
  id: datasetId,
  name: 'Quarterly sales',
  fileName: 'quarterly-sales.csv',
  rowCount: 2180,
  skippedRows: 0,
  columns: [
    { position: 0, name: 'Month', typeName: 'date', isNullable: false },
    { position: 1, name: 'Revenue', typeName: 'decimal', isNullable: false },
  ],
}
const preview = {
  result: {
    columns: [
      { key: 'groupValue', label: 'Month', typeName: 'date' },
      { key: 'm0', label: 'Revenue', typeName: 'decimal' },
    ],
    rows: [{ groupValue: '2026-01-01', m0: 123 }],
  },
  cacheStatus: 'MISS',
  durationMilliseconds: 3,
}

describe('ChartEditorPage', () => {
  beforeEach(() => {
    sessionStorage.setItem('datalens.accessToken', 'test-token')
    apiMocks.get.mockImplementation((path: string) => Promise.resolve(path === '/datasets' ? [dataset] : dataset))
    apiMocks.post.mockResolvedValue(preview)
  })

  it('keeps the query settings when the chart type changes', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/charts/new?dataset=${datasetId}`]}>
            <Routes><Route path="/charts/new" element={<ChartEditorPage />} /></Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    )

    const groupBy = await screen.findByRole('combobox', { name: 'X axis / group by' })
    await user.click(groupBy)
    await user.click(within(screen.getByRole('listbox', { name: 'X axis / group by' })).getByRole('option', { name: 'Month · date' }))

    await user.click(screen.getByRole('combobox', { name: 'Metric 1 aggregation' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Metric 1 aggregation' })).getByRole('option', { name: 'SUM' }))
    const metricColumn = screen.getByRole('combobox', { name: 'Metric 1 column' })
    fireEvent.focus(metricColumn)
    fireEvent.change(metricColumn, { target: { value: 'Revenue' } })
    await user.click(within(screen.getByRole('listbox', { name: 'Metric 1 column' })).getByRole('option', { name: 'Revenue · decimal' }))

    await user.click(screen.getByRole('combobox', { name: 'Chart type' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Chart type' })).getByRole('option', { name: 'Line' }))

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenLastCalledWith(
        '/charts/preview',
        expect.objectContaining({
          chartType: 'line',
          query: expect.objectContaining({
            groupByPosition: 0,
            groupByPositions: [0],
            metrics: [{ function: 'sum', columnPosition: 1 }],
          }),
        }),
        expect.anything(),
      )
    })
  })
})
