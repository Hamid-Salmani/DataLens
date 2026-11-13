import { expect, test } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const screenshotDirectory = resolve(process.cwd(), '..', 'docs', 'screenshots', 'final')
const demoEmail = 'demo@datalens.local'
const demoPassword = 'DemoPassword123!'

test('live login, CSV import, chart editor, dashboard persistence, and PDF export', async ({ page, request }) => {
  const suffix = `${Date.now()}`
  const datasetName = `E2E sales ${suffix}`
  const chartName = `E2E revenue ${suffix}`
  const dashboardName = `E2E board ${suffix}`
  const email = `live-e2e-${suffix}@example.com`
  const password = 'StrongPassword123!'

  const registration = await request.post('http://localhost:5000/api/auth/register', {
    data: { email, password, firstName: 'Live', lastName: 'E2E' },
  })
  expect(registration.ok(), await registration.text()).toBeTruthy()
  await page.addInitScript(() => localStorage.setItem('datalens.theme', 'dark'))
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/datasets$/)
  await expect(page.getByRole('heading', { name: 'Datasets', exact: true })).toBeVisible()

  await page.locator('input[type="file"]').setInputFiles({
    name: 'live-e2e-sales.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('category,revenue\nNorth,125.5\nSouth,240\nWest,95.25\n', 'utf8'),
  })
  await page.getByLabel('Dataset name').fill(datasetName)
  await page.getByRole('button', { name: 'Import CSV' }).click()
  await expect(page.getByText('Imported 3 rows.', { exact: true })).toBeVisible({ timeout: 30_000 })

  const token = await page.evaluate(() => sessionStorage.getItem('datalens.accessToken'))
  const datasetsResponse = await page.request.get('http://localhost:5000/api/datasets', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(datasetsResponse.ok()).toBeTruthy()
  const datasets = await datasetsResponse.json() as Array<{ id: string; name: string }>
  const datasetId = datasets.find(dataset => dataset.name === datasetName)?.id
  expect(datasetId).toBeTruthy()

  await page.goto(`/charts/new?dataset=${datasetId}`)
  await expect(page.getByRole('heading', { name: 'Create chart', exact: true })).toBeVisible()
  await page.getByLabel('Chart name').fill(chartName)
  await expect(page.getByRole('application')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Save chart' }).click()
  await expect(page).toHaveURL(/\/charts$/)
  await expect(page.getByText(chartName, { exact: true })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await page.getByLabel('New board').fill(dashboardName)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText(dashboardName, { exact: true }).first()).toBeVisible()
  const setDefaultButton = page.getByRole('button', { name: 'Set as default' })
  if (await setDefaultButton.count()) await setDefaultButton.click()
  await page.getByRole('button', { name: 'Edit layout' }).click()
  await page.getByRole('button', { name: 'Add chart' }).first().click()
  const chartPicker = page.getByRole('dialog', { name: 'Add a chart' })
  await chartPicker.getByLabel('Search saved charts').fill(chartName)
  await chartPicker.getByRole('button', { name: 'Add', exact: true }).click()

  const widget = page.getByRole('article', { name: `${chartName} chart widget` })
  await expect(widget).toBeVisible()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.reload()
  await expect(page.getByRole('article', { name: `${chartName} chart widget` })).toBeVisible()

  await page.getByRole('button', { name: 'Export PDF' }).click()
  await expect(page.getByRole('status')).toContainText('Dashboard PDF queued.', { timeout: 10_000 })
  await page.getByRole('link', { name: 'Exports' }).click()
  const exportJob = page.getByRole('listitem').filter({ hasText: dashboardName })
  await expect(exportJob.getByText('Completed', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(exportJob.getByText('100%')).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportJob.getByRole('button', { name: 'Download' }).click(),
  ])
  expect(download.suggestedFilename()).toContain('.pdf')
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  const pdf = await readFile(downloadPath!)
  expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')

  const accessToken = await page.evaluate(() => sessionStorage.getItem('datalens.accessToken'))
  const deleted = await page.request.delete('http://localhost:5000/api/auth/account', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { password },
  })
  expect(deleted.status()).toBe(204)
})

test('captures final live-stack screenshots for every workspace route in both themes and viewports', async ({ page }) => {
  await mkdir(screenshotDirectory, { recursive: true })
  const login = await page.request.post('http://localhost:5000/api/auth/login', {
    data: { email: demoEmail, password: demoPassword },
  })
  expect(login.ok(), await login.text()).toBeTruthy()
  const auth = await login.json() as { accessToken: string }

  await page.goto('/welcome')
  await expect(page.getByRole('heading', { name: 'Make your data easier to see.' })).toBeVisible()

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 })
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate(value => localStorage.setItem('datalens.theme', value), theme)
      await page.goto('/welcome')
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
      else await expect(page.locator('html')).not.toHaveClass(/dark/)
      await expect(page.getByRole('heading', { name: 'Make your data easier to see.' })).toBeVisible()
      await page.screenshot({ path: resolve(screenshotDirectory, `landing-${theme}-${width}.png`), fullPage: true })

      await page.evaluate(() => sessionStorage.removeItem('datalens.accessToken'))
      await page.goto('/auth')
      await expect(page.getByRole('heading', { name: 'Sign in to DataLens' })).toBeVisible()
      await page.screenshot({ path: resolve(screenshotDirectory, `auth-${theme}-${width}.png`), fullPage: true })
      await page.evaluate(token => sessionStorage.setItem('datalens.accessToken', token), auth.accessToken)

      const datasetResponse = await page.request.get('http://localhost:5000/api/datasets', {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      })
      expect(datasetResponse.ok()).toBeTruthy()
      const datasets = await datasetResponse.json() as Array<{ id: string; name: string }>
      const dataset = datasets[0]
      expect(dataset).toBeTruthy()

      const routes = [
        { path: '/', name: 'dashboard', heading: 'Dashboard' },
        { path: '/datasets', name: 'datasets', heading: 'Datasets' },
        { path: '/charts', name: 'charts', heading: 'Charts' },
        { path: `/charts/new?dataset=${dataset.id}`, name: 'chart-editor', heading: 'Create chart' },
        { path: '/exports', name: 'exports', heading: 'Exports' },
        { path: '/settings', name: 'settings', heading: 'Settings' },
        { path: `/datasets/${dataset.id}`, name: 'dataset-detail', heading: dataset.name },
      ]

      for (const route of routes) {
        await page.goto(route.path)
        await expect(page.getByTestId('app-layout-header')).toBeVisible()
        await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible()
        if (width === 390) {
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        }
        await page.screenshot({ path: resolve(screenshotDirectory, `${route.name}-${theme}-${width}.png`), fullPage: true })
      }
    }
  }
})
