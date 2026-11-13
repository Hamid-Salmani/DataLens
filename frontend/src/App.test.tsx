import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('dashboard launch flow', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    sessionStorage.clear()
    window.history.pushState({}, '', '/')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'Healthy' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
  })

  it('navigates from the landing page to sign-in', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: 'Launch dashboard' }))

    expect(await screen.findByRole('heading', { name: 'Sign in to DataLens' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveClass('whitespace-nowrap')
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/health'))
  })

  it('shows a friendly email error without sending an invalid login request', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Launch dashboard' }))
    await screen.findByRole('heading', { name: 'Sign in to DataLens' })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'any-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter a valid email address, like name@example.com.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('requires matching passwords before registration', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Launch dashboard' }))
    await screen.findByRole('heading', { name: 'Sign in to DataLens' })
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }))
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Taylor' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'User' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'taylor@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'StrongPassword1!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'StrongPassword2!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Your passwords do not match.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('explains when the backend is unavailable instead of showing a gateway error', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      if (input === '/health') {
        return Promise.resolve(new Response(JSON.stringify({ status: 'Healthy' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response('<html>Bad Gateway</html>', { status: 502 }))
    })

    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Launch dashboard' }))
    await screen.findByRole('heading', { name: 'Sign in to DataLens' })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'taylor@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'any-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The DataLens API is unavailable. Start the backend, then try again.',
    )
  })

  it('loads dataset details, applies server-side sorting, and saves renamed columns', async () => {
    const datasetId = '3172dbad-15d7-4a2d-bbac-5ca964c88681'
    let renamed = false
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith(`/datasets/${datasetId}/columns/0`) && init?.method === 'PUT') {
        renamed = true
        return new Response(JSON.stringify({
          position: 0,
          name: 'Customer',
          typeName: 'text',
          isNullable: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      if (url.endsWith(`/datasets/${datasetId}`)) {
        return new Response(JSON.stringify({
          id: datasetId,
          name: 'Customers',
          fileName: 'customers.csv',
          rowCount: 2,
          skippedRows: 0,
          createdAt: '2026-01-01T00:00:00Z',
          columns: [
            { position: 0, name: renamed ? 'Customer' : 'Name', typeName: 'text', isNullable: true },
            { position: 1, name: 'Amount', typeName: 'integer', isNullable: true },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      if (url.includes(`/datasets/${datasetId}/preview`)) {
        return new Response(JSON.stringify({
          datasetId,
          totalRows: 120,
          page: Number(new URL(url, window.location.origin).searchParams.get('page') ?? '1'),
          pageSize: 50,
          rows: renamed
            ? [{ Customer: 'Acme', Amount: 12 }, { Customer: 'Northwind', Amount: 7 }]
            : [{ Name: 'Acme', Amount: 12 }, { Name: 'Northwind', Amount: 7 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      return new Response(null, { status: 404 })
    })
    sessionStorage.setItem('datalens.accessToken', 'test-token')
    window.history.pushState({}, '', `/datasets/${datasetId}`)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to datasets' })).toHaveClass('whitespace-nowrap')
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    const previewCell = screen.getByRole('cell', { name: 'Acme' })
    expect(previewCell.closest('tbody')).toBeInTheDocument()
    expect(previewCell.closest('tr')?.style.transform).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Amount' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('sortBy=Amount&sortDirection=asc'),
      expect.objectContaining({ headers: expect.any(Headers) }),
    ))

    fireEvent.click(screen.getByRole('button', { name: 'Rename Name' }))
    const columnNameInput = screen.getByLabelText('Column 1 name')
    fireEvent.change(columnNameInput, { target: { value: 'Customer' } })
    fireEvent.keyDown(columnNameInput, { key: 'Enter' })
    fireEvent.submit(columnNameInput.closest('form') as HTMLFormElement)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/datasets/${datasetId}/columns/0`,
      expect.objectContaining({ method: 'PUT' }),
    ))
    expect(await screen.findByRole('button', { name: 'Rename Customer' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Create chart from this dataset' })).toHaveAttribute('href', `/charts/new?dataset=${datasetId}`)
    const tableViewport = screen.getByTestId('preview-scroll')
    if (!tableViewport) throw new Error('Data table viewport not found.')
    Object.defineProperty(tableViewport, 'scrollTop', { value: 120, writable: true })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(window.location.search).toContain('page=2'))
    expect(screen.getByTestId('preview-scroll')).toBe(tableViewport)
    expect(tableViewport.scrollTop).toBe(120)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('page=2&pageSize=50'),
      expect.objectContaining({ headers: expect.any(Headers) }),
    ))
  })

  it('stacks dataset metadata and actions in the mobile workspace row layout', async () => {
    const datasetId = '8a0d5208-c111-42ca-9fe5-0537a1b76c01'
    sessionStorage.setItem('datalens.accessToken', 'test-token')
    window.history.pushState({}, '', '/dashboard')
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) {
        return new Response(JSON.stringify({ id: 'user', email: 'person@example.com', firstName: 'Alex', lastName: 'User' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/datasets')) {
        return new Response(JSON.stringify([{
          id: datasetId,
          name: 'Quarterly customer revenue',
          fileName: 'quarterly-customer-revenue-export.csv',
          rowCount: 1234,
          skippedRows: 0,
          createdAt: '2026-01-01T00:00:00Z',
          columnCount: 12,
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/dashboard/summary')) {
        return new Response(JSON.stringify({ datasetCount: 1, totalRows: 1234, latestDataset: null }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 404 })
    })

    render(<App />)

    const title = await screen.findByText('Quarterly customer revenue')
    const row = title.closest('article')
    expect(row).toHaveClass('grid-cols-[42px_minmax(0,1fr)]', 'sm:flex')
    expect(screen.getByText(/quarterly-customer-revenue-export\.csv/).closest('article')).toBe(row)
    const openLink = screen.getByRole('link', { name: 'Open dataset' })
    expect(openLink.closest('div')).toHaveClass('col-span-2', 'flex-wrap')
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })

})
