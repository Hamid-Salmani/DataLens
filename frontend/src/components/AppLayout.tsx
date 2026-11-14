import { useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { BarChart3, ChevronLeft, ChevronRight, Database, LayoutDashboard, LogOut, Menu, Settings, X, Download } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api, type User } from '../lib/api'
import { ThemeToggle } from '../theme'

const navigation = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  { label: 'Datasets', to: '/datasets', icon: Database },
  { label: 'Charts', to: '/charts', icon: BarChart3 },
  { label: 'Exports', to: '/exports', icon: Download },
  { label: 'Settings', to: '/settings', icon: Settings },
]

export function AppLayout({ children }: { children?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('datalens.sidebarCollapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const location = useLocation()
  const token = sessionStorage.getItem('datalens.accessToken')
  const userQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: () => api.get<User>('/auth/me'),
    enabled: Boolean(token),
  })

  if (!token) return <Navigate to="/auth" replace state={{ from: location.pathname }} />

  const user = userQuery.data
  const userName = user ? `${user.firstName} ${user.lastName}` : 'Loading account'
  const initials = user ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}` : '…'
  const collapse = () => {
    setCollapsed(value => {
      localStorage.setItem('datalens.sidebarCollapsed', String(!value))
      return !value
    })
  }
  const signOut = () => {
    sessionStorage.removeItem('datalens.accessToken')
    window.location.assign('/welcome')
  }

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      {mobileOpen && <button className="fixed inset-0 z-40 bg-black/50 md:hidden" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-border bg-surface transition-[width,transform] md:sticky md:top-0 md:h-screen md:translate-x-0 ${collapsed ? 'md:w-[76px]' : 'md:w-[264px]'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Main sidebar"
      >
        <div className={`flex h-[72px] items-center border-b border-border px-5 ${collapsed ? 'md:justify-center md:px-2' : 'justify-between'}`}>
          <Link className="inline-flex items-center gap-3 text-lg font-bold text-foreground no-underline" to="/" aria-label="DataLens dashboard">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary font-bold text-background">D</span>
            <span className={collapsed ? 'md:hidden' : ''}>DataLens</span>
          </Link>
          <button className="rounded-lg p-2 text-muted hover:bg-surface-raised md:hidden" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button>
          <button className="hidden rounded-lg p-2 text-muted hover:bg-surface-raised md:inline-flex" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={collapse}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Workspace navigation">
          {navigation.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              aria-label={label}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold no-underline transition-colors ${collapsed ? 'md:justify-center md:px-0' : ''} ${isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surface-raised hover:text-foreground'}`}
            >
              <Icon size={19} aria-hidden="true" />
              <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
              {collapsed && <span className="pointer-events-none absolute left-[68px] z-50 hidden rounded-md bg-surface-raised px-2 py-1 text-xs text-foreground shadow-lg group-hover:block group-focus-visible:block md:group-hover:block">{label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="relative border-t border-border p-3">
          {userMenuOpen && <div className="absolute bottom-[calc(100%-4px)] left-3 right-3 z-20 rounded-xl border border-border bg-surface p-2 shadow-xl" role="menu" aria-label="User menu">
            <div className="px-3 py-2 text-xs text-muted">{user?.email}</div>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger/10" type="button" role="menuitem" onClick={signOut}><LogOut size={16} />Sign out</button>
          </div>}
          <button className={`flex min-h-12 w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-raised ${collapsed ? 'md:justify-center' : ''}`} type="button" aria-expanded={userMenuOpen} aria-label="Open user menu" onClick={() => setUserMenuOpen(value => !value)}>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary" aria-hidden="true">{initials}</span>
            <span className={`min-w-0 flex-1 truncate text-sm font-semibold text-foreground ${collapsed ? 'md:hidden' : ''}`}>{userName}</span>
            <span className={`truncate text-xs text-muted ${collapsed ? 'md:hidden' : ''}`}>{user?.email ?? ''}</span>
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header data-testid="app-layout-header" className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-muted hover:bg-surface-raised md:hidden" type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <span className="text-sm font-semibold text-muted">{navigation.find(item => item.to === location.pathname)?.label ?? (location.pathname.startsWith('/datasets/') ? 'Dataset details' : 'Chart editor')}</span>
          </div>
          <ThemeToggle />
        </header>
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8 md:py-8">{children ?? <Outlet />}</div>
      </div>
    </div>
  )
}

export function PageContainer({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`w-full ${className}`}>{children}</div>
}

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4" data-testid="page-header">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">{eyebrow}</p>}
        <h1 className="m-0 text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-2 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
