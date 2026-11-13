import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { PageContainer, PageHeader } from '../../components/AppLayout'
import { Select } from '../../components/Select'
import { api, downloadExportFile, type Dashboard, type Dataset, type ExportJob, type SavedChart, type User } from '../../lib/api'
import { ThemeToggle } from '../../theme'

export function ExportsPage() {
  const [datasetId, setDatasetId] = useState('')
  const [chartId, setChartId] = useState('')
  const [dashboardId, setDashboardId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: () => api.get<Dataset[]>('/datasets') })
  const charts = useQuery({ queryKey: ['charts'], queryFn: () => api.get<SavedChart[]>('/charts') })
  const dashboards = useQuery({ queryKey: ['dashboards'], queryFn: () => api.get<Dashboard[]>('/dashboards') })
  const jobs = useQuery({
    queryKey: ['exports'],
    queryFn: () => api.get<ExportJob[]>('/exports'),
    refetchInterval: query => query.state.data?.some(job => job.status === 'Queued' || job.status === 'Running') ? 1500 : false,
  })

  const createExport = async (event: FormEvent) => {
    event.preventDefault()
    if (!datasetId) return
    setBusy(true)
    setError('')
    try {
      await api.post<ExportJob>('/exports', { datasetId })
      await jobs.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start this export.')
    } finally {
      setBusy(false)
    }
  }

  const deleteExport = async (job: ExportJob) => {
    setError('')
    try {
      await api.delete(`/exports/${job.id}`)
      await jobs.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this export.')
    }
  }

  const download = async (job: ExportJob) => {
    setError('')
    try {
      await downloadExportFile(job)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download this export.')
    }
  }

  const createPdf = async (targetType: 'charts' | 'dashboards', targetId: string) => {
    if (!targetId) return
    setBusy(true)
    setError('')
    try {
      await api.post<ExportJob>(`/exports/${targetType}/${targetId}`, {})
      await jobs.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start this PDF export.')
    } finally {
      setBusy(false)
    }
  }

  const datasetOptions = (datasets.data ?? []).map(dataset => ({ value: dataset.id, label: dataset.name }))
  return (
    <PageContainer>
      <PageHeader eyebrow="Data delivery" title="Exports" description="Create CSV exports and PDF reports for datasets, charts, and dashboards." />
      {error && <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger" role="alert">{error}</p>}
      <div className="mb-5 grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-3">
        <form className="grid content-end gap-2" onSubmit={event => void createExport(event)}>
          <label className="grid gap-1 text-xs font-semibold text-muted">Dataset CSV
            <Select label="Dataset to export" value={datasetId} options={datasetOptions} onChange={setDatasetId} searchable />
          </label>
          <button className="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background disabled:opacity-50" type="submit" disabled={busy || !datasetId}>
            {busy ? 'Starting…' : 'Create CSV export'}
          </button>
        </form>
        <div className="grid content-end gap-2">
          <label className="grid gap-1 text-xs font-semibold text-muted">Chart PDF
            <Select label="Chart to export as PDF" value={chartId} options={(charts.data ?? []).map(chart => ({ value: chart.id, label: `${chart.name} · ${chart.datasetName}` }))} onChange={setChartId} searchable />
          </label>
          <button className="min-h-10 rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50" type="button" disabled={busy || !chartId} onClick={() => void createPdf('charts', chartId)}>Create chart PDF</button>
        </div>
        <div className="grid content-end gap-2">
          <label className="grid gap-1 text-xs font-semibold text-muted">Dashboard PDF
            <Select label="Dashboard to export as PDF" value={dashboardId} options={(dashboards.data ?? []).map(dashboard => ({ value: dashboard.id, label: dashboard.name }))} onChange={setDashboardId} searchable />
          </label>
          <button className="min-h-10 rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50" type="button" disabled={busy || !dashboardId} onClick={() => void createPdf('dashboards', dashboardId)}>Create dashboard PDF</button>
        </div>
      </div>
      {(datasets.isError || charts.isError || dashboards.isError) && <p className="text-sm text-danger" role="alert">Could not load one or more export sources.</p>}
      <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-label="Export jobs">
        <div className="border-b border-border px-4 py-3"><h2 className="m-0 text-lg font-semibold text-foreground">Export jobs</h2></div>
        {jobs.isPending ? <p className="p-6 text-center text-muted" role="status">Loading exports…</p>
          : jobs.isError ? <p className="p-4 text-danger" role="alert">Could not load export jobs. <button className="underline" type="button" onClick={() => void jobs.refetch()}>Retry</button></p>
            : !jobs.data?.length ? <div className="p-8 text-center text-muted">No exports yet. Choose a dataset above to start one.</div>
              : <ul className="m-0 divide-y divide-border p-0">
                {jobs.data.map(job => <li className="flex flex-wrap items-center gap-4 p-4" key={job.id}>
                  <div className="min-w-48 flex-1">
                    <strong className="block text-sm text-foreground">{job.targetName}</strong>
                    <span className="block text-xs text-muted">{job.type === 'DatasetCsv' ? 'Dataset CSV' : job.type === 'ChartPdf' ? 'Chart PDF' : 'Dashboard PDF'}</span>
                    <span className="text-xs text-muted">{job.fileName} · {new Date(job.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="min-w-36 flex-1">
                    <div className="mb-1 flex justify-between text-xs"><span className="text-foreground">{job.status}</span><span className="text-muted">{job.progress}%</span></div>
                    <progress className="h-2 w-full accent-primary" max={100} value={job.progress} aria-label={`${job.targetName} export progress`} />
                    {job.errorMessage && <p className="mt-1 text-xs text-danger">{job.errorMessage}</p>}
                  </div>
                  <div className="flex gap-2">
                    {job.status === 'Completed' && <button className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs font-semibold text-foreground" type="button" onClick={() => void download(job)}>Download</button>}
                    <button className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-danger disabled:opacity-50" type="button" disabled={job.status === 'Running'} onClick={() => void deleteExport(job)}>Delete</button>
                  </div>
                </li>)}
              </ul>}
      </section>
    </PageContainer>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  const userQuery = useQuery({ queryKey: ['current-user'], queryFn: () => api.get<User>('/auth/me') })
  const dashboardsQuery = useQuery({ queryKey: ['dashboards'], queryFn: () => api.get<Dashboard[]>('/dashboards') })
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      await api.post<void>('/auth/change-password', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setMessage('Password changed.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change your password.')
    }
  }

  const setDefaultDashboard = async (dashboardId: string) => {
    setError('')
    setMessage('')
    try {
      await api.post<void>(`/dashboards/${dashboardId}/default`, {})
      await dashboardsQuery.refetch()
      setMessage('Default dashboard updated.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the default dashboard.')
    }
  }

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault()
    if (!window.confirm('Delete your account and all datasets, charts, dashboards, and export files? This cannot be undone.')) return
    setError('')
    try {
      await api.delete('/auth/account', { password: deletePassword })
      sessionStorage.removeItem('datalens.accessToken')
      navigate('/welcome', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete your account.')
    }
  }

  const dashboards = dashboardsQuery.data ?? []
  const currentDefault = dashboards.find(dashboard => dashboard.isDefault)?.id ?? ''
  return (
    <PageContainer>
      <PageHeader eyebrow="Workspace preferences" title="Settings" description="Manage your profile, security, and dashboard defaults." />
      {(error || userQuery.isError || dashboardsQuery.isError) && <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger" role="alert">{error || 'Could not load your account settings.'}</p>}
      {message && <p className="mb-4 rounded-lg border border-success/40 bg-success/10 p-3 text-success" role="status">{message}</p>}
      <div className="grid max-w-3xl gap-4">
        {userQuery.data
          ? <ProfileSettingsForm
              key={userQuery.data.id}
              user={userQuery.data}
              onError={setError}
              onSaved={() => setMessage('Profile saved.')}
            />
          : <p className="text-sm text-muted" role="status">Loading profile…</p>}
        <form className="grid gap-3 rounded-xl border border-border bg-surface p-4" onSubmit={event => void changePassword(event)}>
          <h2 className="m-0 text-lg font-semibold text-foreground">Change password</h2>
          <label className="grid gap-1 text-xs font-semibold text-muted">Current password<input className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-foreground" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
          <label className="grid gap-1 text-xs font-semibold text-muted">New password<input className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-foreground" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={10} required /></label>
          <button className="w-fit rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-semibold text-foreground" type="submit">Change password</button>
        </form>
        <section className="grid gap-3 rounded-xl border border-border bg-surface p-4">
          <h2 className="m-0 text-lg font-semibold text-foreground">Preferences</h2>
          <div className="flex items-center justify-between gap-4"><div><strong className="text-sm text-foreground">Color theme</strong><p className="m-0 text-xs text-muted">Theme preference is saved in this browser.</p></div><ThemeToggle /></div>
          <label className="grid max-w-md gap-1 text-xs font-semibold text-muted">Default dashboard
            <Select label="Default dashboard" value={currentDefault} options={dashboards.map(dashboard => ({ value: dashboard.id, label: dashboard.name }))} onChange={value => void setDefaultDashboard(value)} />
          </label>
          {dashboards.length === 0 && <p className="m-0 text-xs text-muted">Create a dashboard before choosing a default.</p>}
          <Link className="w-fit text-sm font-semibold text-primary" to="/">Open dashboard</Link>
        </section>
        <form className="grid gap-3 rounded-xl border border-danger/40 bg-surface p-4" onSubmit={event => void deleteAccount(event)}>
          <h2 className="m-0 text-lg font-semibold text-danger">Delete account</h2>
          <p className="m-0 text-sm text-muted">This permanently deletes your account and all associated data.</p>
          <label className="grid gap-1 text-xs font-semibold text-muted">Confirm with your password<input className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-foreground" type="password" autoComplete="current-password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} required /></label>
          <button className="w-fit rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white" type="submit">Delete my account</button>
        </form>
      </div>
    </PageContainer>
  )
}

function ProfileSettingsForm({
  user,
  onError,
  onSaved,
}: {
  user: User
  onError: (message: string) => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [firstName, setFirstName] = useState(user.firstName)
  const [lastName, setLastName] = useState(user.lastName)

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    onError('')
    try {
      const updated = await api.put<User>('/auth/profile', { firstName, lastName })
      queryClient.setQueryData(['current-user'], updated)
      onSaved()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not save your profile.')
    }
  }

  return (
    <form className="grid gap-3 rounded-xl border border-border bg-surface p-4" onSubmit={event => void saveProfile(event)}>
      <h2 className="m-0 text-lg font-semibold text-foreground">Profile</h2>
      <p className="m-0 text-sm text-muted">{user.email}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-muted">First name<input className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-foreground" value={firstName} onChange={event => setFirstName(event.target.value)} required maxLength={120} /></label>
        <label className="grid gap-1 text-xs font-semibold text-muted">Last name<input className="min-h-10 rounded-lg border border-border bg-surface-raised px-3 text-foreground" value={lastName} onChange={event => setLastName(event.target.value)} required maxLength={120} /></label>
      </div>
      <button className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background" type="submit">Save profile</button>
    </form>
  )
}
