import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'softtrack.theme'

const media = () =>
  typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

/** What the user chose, or null to follow the system. */
function stored(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return media()?.matches ? 'dark' : 'light'
}

/** Resolve and stamp the theme on <html>. Mirrors the inline script in index.html. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

/**
 * The current theme and a toggle.
 *
 * An explicit choice is remembered; with none, the system preference is
 * followed live. index.html applies the same rule before React loads so the
 * first paint is already the right colour.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? systemTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const query = media()
    if (!query) return
    const follow = () => {
      if (stored() === null) setTheme(query.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        // Storage can be unavailable; the choice then lasts the session.
      }
      return next
    })
  }, [])

  return { theme, toggle }
}
