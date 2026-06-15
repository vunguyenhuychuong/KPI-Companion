import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)

function getSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function initialThemeMode() {
  const saved = localStorage.getItem('kpi_theme')
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'light'
}

export function ThemeProvider({ children }) {
  const [themeMode, setThemeModeState] = useState(initialThemeMode)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handler = (e) => setSystemTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  function setThemeMode(mode) {
    setThemeModeState(mode)
    localStorage.setItem('kpi_theme', mode)
  }

  function toggleTheme() {
    const next = resolvedTheme === 'light' ? 'dark' : 'light'
    setThemeMode(next)
  }

  return (
    <ThemeContext.Provider value={{ theme: resolvedTheme, themeMode, setThemeMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  return {
    theme: ctx?.theme ?? 'light',
    themeMode: ctx?.themeMode ?? 'light',
    setThemeMode: ctx?.setThemeMode ?? (() => {}),
    toggleTheme: ctx?.toggleTheme ?? (() => {}),
  }
}
