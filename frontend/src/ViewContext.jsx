import { createContext, useContext, useState } from 'react'

const ViewContext = createContext(null)

const DEFAULT_VIEW_MODE = 'work'

export const VIEW_MODES = ['work', 'personal']

export function ViewProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    const saved = localStorage.getItem('kpi_view')
    return VIEW_MODES.includes(saved) ? saved : DEFAULT_VIEW_MODE
  })

  function setMode(next) {
    const v = VIEW_MODES.includes(next) ? next : DEFAULT_VIEW_MODE
    setModeState(v)
    localStorage.setItem('kpi_view', v)
  }

  return <ViewContext.Provider value={{ mode, setMode }}>{children}</ViewContext.Provider>
}

export function useView() {
  const ctx = useContext(ViewContext)
  return { mode: ctx?.mode ?? DEFAULT_VIEW_MODE, setMode: ctx?.setMode ?? (() => {}) }
}

// Loc 1 KPI-status theo che do hien thi.
// kpiStatus: { kpi: {category}, health }  (Dashboard) hoac truyen {category, health} truc tiep.
export function matchView(mode, category, health) {
  if (mode === 'work') return (category || 'Work') === 'Work'
  if (mode === 'personal') return (category || 'Work') === 'Personal'
  if (mode === 'focus') return health !== 'green'
  return true
}
