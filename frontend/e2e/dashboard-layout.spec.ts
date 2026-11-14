import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const apiBase = 'http://localhost:5000/api'
const screenshotDirectory = resolve(process.cwd(), '..', 'docs', 'screenshots', 'after')
const password = 'StrongPassword123!'

async function createLiveWorkspace(request: APIRequestContext) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const authResponse = await request.post(`${apiBase}/auth/register`, {
    data: {
      email: `rgl-${suffix}@example.com`,
      password,
      firstName: 'Grid',
      lastName: 'Tester',
    },
  })
  expect(authResponse.ok(), await authResponse.text()).toBeTruthy()
  const auth = await authResponse.json() as { accessToken: string }
  const headers = { Authorization: `Bearer ${auth.accessToken}` }

  const uploadResponse = await request.post(`${apiBase}/datasets`, {
    headers,
    multipart: {
      name: `Grid layout ${suffix}`,
      file: {
        name: 'grid-layout.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('category,amount\nAlpha,10\nBeta,20\nGamma,30\n', 'utf8'),
      },
    },
  })
  expect(uploadResponse.ok(), await uploadResponse.text()).toBeTruthy()
  const upload = await uploadResponse.json() as { jobId: string; datasetId: string }
  await expect.poll(async () => {
    const response = await request.get(`${apiBase}/import-jobs/${upload.jobId}`, { headers })
    if (!response.ok()) return 'Missing'
    const job = await response.json() as { status: string }
    return job.status
  }, { message: 'real SQL Server CSV import should complete' }).toBe('Completed')

  const query = {
    groupByPosition: 0,
    groupByPositions: [0],
    metrics: [{ function: 'sum', columnPosition: 1 }],
    filters: [],
    topN: 20,
    sortBy: 'm0',
    sortDirection: 'desc',
    timeBucketPosition: null,
    timeBucket: null,
  }
  const options = {
    title: 'Revenue by category',
    xAxisLabel: 'Category',
    yAxisLabel: 'Amount',
    showLegend: true,
    stacked: false,
    colors: ['#167b91', '#69a98a'],
    numberFormat: 'number',
  }

  const chartIds: string[] = []
  for (const name of ['Live revenue chart one', 'Live revenue chart two']) {
    const chartResponse = await request.post(`${apiBase}/charts`, {
      headers,
      data: { name, description: 'Live SQL Server RGL test', datasetId: upload.datasetId, chartType: 'bar', query, options },
    })
    expect(chartResponse.ok(), await chartResponse.text()).toBeTruthy()
    const chart = await chartResponse.json() as { id: string }
    chartIds.push(chart.id)
  }

  const dashboardResponse = await request.post(`${apiBase}/dashboards`, {
    headers,
    data: { name: `Grid dashboard ${suffix}` },
  })
  expect(dashboardResponse.ok(), await dashboardResponse.text()).toBeTruthy()
  const dashboard = await dashboardResponse.json() as { id: string }
  for (const [index, savedChartId] of chartIds.entries()) {
    const widgetResponse = await request.post(`${apiBase}/dashboards/${dashboard.id}/widgets`, {
      headers,
      data: { savedChartId, x: index === 0 ? 0 : 6, y: 0, width: 4, height: 4 },
    })
    expect(widgetResponse.ok(), await widgetResponse.text()).toBeTruthy()
  }

  return {
    token: auth.accessToken,
    email: `rgl-${suffix}@example.com`,
    headers,
    dashboardId: dashboard.id,
    dashboardName: `Grid dashboard ${suffix}`,
    datasetId: upload.datasetId,
    datasetName: `Grid layout ${suffix}`,
    chartIds,
  }
}

async function goToShellPage(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('app-layout-header')).toBeVisible()
  const unexpectedHeaders = await page.locator('header:not([data-testid="app-layout-header"]):not(.dashboard-widget-drag-handle)').count()
  expect(unexpectedHeaders, `page ${path} should not render its own shell header`).toBe(0)
}

test('real-data dashboard grid drag and corner resize persist, and every authenticated page uses the shared shell', async ({ page, request }) => {
  mkdirSync(screenshotDirectory, { recursive: true })
  const workspace = await createLiveWorkspace(request)
  await page.addInitScript(({ token }) => {
    sessionStorage.setItem('datalens.accessToken', token)
    localStorage.setItem('datalens.theme', 'dark')
  }, { token: workspace.token })
  await page.setViewportSize({ width: 1440, height: 1100 })

  const before = await request.get(`${apiBase}/dashboards/${workspace.dashboardId}`, { headers: workspace.headers })
  expect(before.ok()).toBeTruthy()
  const original = await before.json() as { version: string; widgets: Array<{ id: string; x: number; y: number; width: number; height: number }> }
  await goToShellPage(page, '/')
  await expect(page.getByRole('article', { name: 'Live revenue chart one chart widget' })).toBeVisible()
  await expect(page.locator('.recharts-surface').first()).toBeVisible()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  const initialCheck = await request.get(`${apiBase}/dashboards/${workspace.dashboardId}`, { headers: workspace.headers })
  expect((await initialCheck.json() as { version: string }).version).toBe(original.version)
  await expect(page.locator('[data-grid-columns="12"]')).toBeVisible()

  await page.screenshot({ path: resolve(screenshotDirectory, 'dashboard-live-grid-dark-1440.png'), fullPage: true })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(page.locator('[data-grid-columns="8"]')).toBeVisible()
  await page.setViewportSize({ width: 900, height: 844 })
  await expect(page.locator('[data-grid-columns="4"]')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-grid-columns="1"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: resolve(screenshotDirectory, 'dashboard-live-grid-light-390.png'), fullPage: true })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Charts' })).toBeVisible()
  await page.getByRole('button', { name: 'Close navigation' }).last().click()
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()

  for (const [route, screenshotName, heading] of [
    ['/datasets', 'datasets', 'Datasets'],
    ['/charts', 'charts', 'Charts'],
    [`/charts/new?dataset=${workspace.datasetId}`, 'chart-editor', 'Create chart'],
    ['/exports', 'exports', 'Exports'],
    ['/settings', 'settings', 'Settings'],
    [`/datasets/${workspace.datasetId}`, 'dataset-detail', workspace.datasetName],
  ] as const) {
    await goToShellPage(page, route)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await page.screenshot({ path: resolve(screenshotDirectory, `app-shell-live-${screenshotName}-dark-1440.png`), fullPage: true })
  }

  await goToShellPage(page, '/')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await page.getByRole('button', { name: 'Edit layout' }).click()
  const movingWidget = page.getByRole('article', { name: 'Live revenue chart one chart widget' })
  const movingHandle = movingWidget.locator('.dashboard-widget-drag-handle')
  const movingBox = await movingHandle.boundingBox()
  expect(movingBox).not.toBeNull()
  if (!movingBox) throw new Error('First widget drag handle is not visible.')
  await page.mouse.move(movingBox.x + 70, movingBox.y + 20)
  await page.mouse.down()
  await page.mouse.move(movingBox.x + 155, movingBox.y + 20, { steps: 15 })
  await expect(page.locator('.react-grid-placeholder')).toBeVisible()
  await page.mouse.up()

  const resizingWidget = page.getByRole('article', { name: 'Live revenue chart two chart widget' })
  const resizeHandle = resizingWidget.locator('xpath=..').locator('.react-resizable-handle-se')
  await expect(resizeHandle).toBeVisible()
  const resizeBox = await resizeHandle.boundingBox()
  expect(resizeBox).not.toBeNull()
  if (!resizeBox) throw new Error('Second widget resize handle is not visible.')
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.move(resizeBox.x + 190, resizeBox.y + 150, { steps: 20 })
  await page.waitForTimeout(100)
  await page.mouse.up()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15000 })

  const after = await request.get(`${apiBase}/dashboards/${workspace.dashboardId}`, { headers: workspace.headers })
  expect(after.ok()).toBeTruthy()
  const saved = await after.json() as { widgets: Array<{ id: string; x: number; y: number; width: number; height: number }> }
  expect(saved.widgets.find(widget => widget.id === original.widgets[0]?.id)).toMatchObject({ y: expect.any(Number) })
  expect(saved.widgets.find(widget => widget.id === original.widgets[0]?.id)?.x).not.toBe(original.widgets[0]?.x)
  const resizedBefore = original.widgets[1]
  const resizedAfter = saved.widgets.find(widget => widget.id === resizedBefore?.id)
  expect(resizedAfter).toBeDefined()
  expect(resizedAfter!.width > (resizedBefore?.width ?? 0) || resizedAfter!.height > (resizedBefore?.height ?? 0)).toBeTruthy()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Edit layout' })).toBeVisible()
  const reloadedBox = await page.getByRole('article', { name: 'Live revenue chart two chart widget' }).boundingBox()
  expect(reloadedBox).not.toBeNull()
  const reloadResponse = await request.get(`${apiBase}/dashboards/${workspace.dashboardId}`, { headers: workspace.headers })
  const reloaded = await reloadResponse.json() as { widgets: typeof saved.widgets }
  expect(reloaded.widgets).toEqual(saved.widgets)
})

test('real-data dashboard date range is URL-backed and auto-refresh pauses while hidden', async ({ page, request }) => {
  mkdirSync(screenshotDirectory, { recursive: true })
  const workspace = await createLiveWorkspace(request)
  await page.addInitScript(({ token }) => {
    sessionStorage.setItem('datalens.accessToken', token)
    localStorage.setItem('datalens.theme', 'dark')
  }, { token: workspace.token })
  await page.setViewportSize({ width: 1440, height: 900 })
  await goToShellPage(page, '/')
  await expect(page.getByRole('article', { name: 'Live revenue chart one chart widget' })).toBeVisible()
  await expect(page.getByText('Filter not applicable').first()).toBeVisible()

  await page.getByRole('combobox', { name: 'Dashboard date range' }).click()
  await page.getByRole('option', { name: 'Last 7 days' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('7d')
  const dateParams = new URL(page.url()).searchParams
  expect(dateParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(dateParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  const filteredPreview = page.waitForResponse(response =>
    response.url().includes('/charts/') &&
    response.url().includes('/preview?from=') &&
    response.url().includes('to=') &&
    response.ok())
  await page.getByRole('button', { name: 'Refresh all' }).click()
  await filteredPreview

  await page.getByRole('combobox', { name: 'Auto-refresh' }).click()
  await page.getByRole('option', { name: '30 seconds' }).click()
  await expect(page.getByText(/Refresh in \d+s/)).toBeVisible()
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }))
  await page.waitForTimeout(2200)
  const pausedCountdown = await page.getByText(/Refresh in \d+s/).textContent()
  await page.waitForTimeout(2200)
  expect(await page.getByText(/Refresh in \d+s/).textContent()).toBe(pausedCountdown)
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }))
  await expect.poll(() => page.getByText(/Refresh in \d+s/).textContent()).not.toBe(pausedCountdown)
  await page.screenshot({ path: resolve(screenshotDirectory, 'dashboard-live-date-range-auto-refresh-dark-1440.png'), fullPage: true })
})

test('development seed shows a live KPI comparison and sparkline', async ({ page, request }) => {
  mkdirSync(screenshotDirectory, { recursive: true })
  const login = await request.post(`${apiBase}/auth/login`, {
    data: { email: 'demo@datalens.local', password: 'DemoPassword123!' },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const auth = await login.json() as { accessToken: string }
  await page.addInitScript(({ token }) => {
    sessionStorage.setItem('datalens.accessToken', token)
    localStorage.setItem('datalens.theme', 'dark')
  }, { token: auth.accessToken })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await goToShellPage(page, '/')

  const dashboardSwitcher = page.getByRole('combobox', { name: 'Dashboard', exact: true })
  await dashboardSwitcher.click()
  await expect(page.getByRole('option').filter({ hasText: 'Sales overview' })).toContainText('6 charts')
  await page.keyboard.press('Escape')

  const kpi = page.getByRole('article', { name: 'Revenue KPI chart widget' })
  await expect(kpi).toBeVisible()
  await expect(kpi.getByText(/vs previous period/)).toBeVisible()
  await expect(kpi.getByRole('img', { name: 'Daily KPI trend' })).toBeVisible()
  await expect(kpi.getByText(/Prev\./)).toBeVisible()
  await page.screenshot({ path: resolve(screenshotDirectory, 'dashboard-demo-kpi-comparison-dark-1440.png'), fullPage: true })
})

test('real-data export completes, downloads, and can be deleted from the Exports page', async ({ page, request }) => {
  mkdirSync(screenshotDirectory, { recursive: true })
  const workspace = await createLiveWorkspace(request)
  await page.addInitScript(({ token }) => {
    sessionStorage.setItem('datalens.accessToken', token)
    localStorage.setItem('datalens.theme', 'dark')
  }, { token: workspace.token })
  await page.setViewportSize({ width: 1440, height: 900 })
  await goToShellPage(page, '/exports')

  const datasetPicker = page.getByRole('combobox', { name: 'Dataset to export' })
  await datasetPicker.fill(workspace.datasetName)
  await page.getByRole('option', { name: workspace.datasetName }).click()
  await page.getByRole('button', { name: 'Create CSV export' }).click()
  const job = page.getByRole('listitem').filter({ hasText: workspace.datasetName })
  await expect(job.getByText('Completed', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(job.getByText('100%')).toBeVisible()
  await page.screenshot({ path: resolve(screenshotDirectory, 'exports-live-completed-dark-1440.png'), fullPage: true })

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    job.getByRole('button', { name: 'Download' }).click(),
  ])
  expect(download.suggestedFilename()).toContain('.csv')
  await job.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No exports yet. Choose a dataset above to start one.')).toBeVisible()
})

test('real-data Settings updates profile, password, theme, default dashboard, and confirms account deletion', async ({ page, request }) => {
  mkdirSync(screenshotDirectory, { recursive: true })
  const workspace = await createLiveWorkspace(request)
  await page.addInitScript(({ token }) => {
    sessionStorage.setItem('datalens.accessToken', token)
    localStorage.setItem('datalens.theme', 'dark')
  }, { token: workspace.token })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await goToShellPage(page, '/settings')

  await page.getByLabel('First name').fill('Settings')
  await page.getByLabel('Last name').fill('Tester')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByRole('status')).toContainText('Profile saved.')
  await page.screenshot({ path: resolve(screenshotDirectory, 'settings-live-profile-dashboard-dark-1440.png'), fullPage: true })

  const passwordForm = page.getByRole('heading', { name: 'Change password' }).locator('xpath=..')
  await passwordForm.getByLabel('Current password').fill(password)
  await passwordForm.getByLabel('New password').fill('UpdatedPassword123!')
  await passwordForm.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('status')).toContainText('Password changed.')
  const updatedLogin = await request.post(`${apiBase}/auth/login`, {
    data: { email: workspace.email, password: 'UpdatedPassword123!' },
  })
  expect(updatedLogin.ok(), await updatedLogin.text()).toBeTruthy()

  await page.getByRole('button', { name: 'Switch to light theme' }).first().click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  const defaultDashboard = page.getByRole('combobox', { name: 'Default dashboard' })
  await defaultDashboard.click()
  await page.getByRole('option', { name: workspace.dashboardName }).click()
  await expect(page.getByRole('status')).toContainText('Default dashboard updated.')

  page.on('dialog', dialog => void dialog.accept())
  const deleteForm = page.getByRole('heading', { name: 'Delete account' }).locator('xpath=..')
  await deleteForm.getByLabel('Confirm with your password').fill('UpdatedPassword123!')
  await deleteForm.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
})
