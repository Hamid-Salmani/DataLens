import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, ThemeToggle } from './theme'

describe('theme preference', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.unstubAllGlobals()
    document.documentElement.classList.remove('dark')
  })

  it('defaults to system preference then persists the selected theme', async () => {
    localStorage.clear()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>)

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))

    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    expect(localStorage.getItem('datalens.theme')).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('uses the saved theme instead of the current system preference', async () => {
    localStorage.setItem('datalens.theme', 'light')
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>)

    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })
})
