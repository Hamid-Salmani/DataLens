import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'
interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem('datalens.theme')
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }, [theme])

  const value = useMemo(() => ({
    theme,
    toggleTheme: () => setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      localStorage.setItem('datalens.theme', next)
      return next
    }),
  }), [theme])

  useEffect(() => {
    if (localStorage.getItem('datalens.theme')) return
    const preference = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!preference) return
    const syncPreference = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light')
    preference.addEventListener('change', syncPreference)
    return () => preference.removeEventListener('change', syncPreference)
  }, [])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function ThemeToggle() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('ThemeToggle must be used within ThemeProvider.')
  return (
    <button
      className="inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs font-semibold text-foreground hover:brightness-105 sm:px-2.5"
      type="button"
      aria-label={`Switch to ${context.theme === 'dark' ? 'light' : 'dark'} theme`}
      onClick={context.toggleTheme}
    >
      <span className="sm:hidden" aria-hidden="true">{context.theme === 'dark' ? '☼' : '☾'}</span>
      <span className="hidden sm:inline">Switch to {context.theme === 'dark' ? 'light' : 'dark'} theme</span>
    </button>
  )
}
