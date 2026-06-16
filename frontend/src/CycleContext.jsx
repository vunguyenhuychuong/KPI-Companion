import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'


const CycleContext = createContext(null)

export function CycleProvider({ children }) {
  const [cycles, setCycles] = useState([])
  const [activeCycleId, setActiveCycleIdState] = useState(() => {
    const saved = localStorage.getItem('kpi_active_cycle')
    return saved ? parseInt(saved, 10) : null
  })
  const [loading, setLoading] = useState(() => !!localStorage.getItem('kpi_token'))

  const fetchCycles = useCallback(async () => {
    const token = localStorage.getItem('kpi_token')
    if (!token) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await api.listCycles()
      setCycles(data || [])
      // Tu dong chon chu ky active: uu tien chu ky dang luu, sau do chu ky is_active=true moi nhat
      setActiveCycleIdState(prev => {
        const valid = (data || []).find(c => c.id === prev)
        if (valid) return prev
        const active = (data || []).find(c => c.is_active)
        const chosen = active ? active.id : (data?.[0]?.id ?? null)
        if (chosen) localStorage.setItem('kpi_active_cycle', chosen)
        return chosen
      })
    } catch (_) {
      // Khong break app neu API fail (user chua login hoac server chua chay)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCycles() }, [fetchCycles])

  function setActiveCycleId(id) {
    setActiveCycleIdState(id)
    if (id) localStorage.setItem('kpi_active_cycle', id)
    else localStorage.removeItem('kpi_active_cycle')
  }

  const activeCycle = cycles.find(c => c.id === activeCycleId) ?? null

  // Lay nam hien tai tu cycle active hoac mac dinh
  const currentYear = useMemo(() => {
    if (activeCycle?.start_date) {
      return new Date(activeCycle.start_date).getFullYear()
    }
    return new Date().getFullYear()
  }, [activeCycle])

  // Kiem tra xem co phai cycle hien tai khong
  const isCurrentYear = useCallback((cycle) => {
    if (!cycle?.start_date) return false
    const cycleYear = new Date(cycle.start_date).getFullYear()
    const now = new Date()
    return cycleYear === now.getFullYear()
  }, [])

  return (
    <CycleContext.Provider value={{
      cycles,
      activeCycleId,
      activeCycle,
      setActiveCycleId,
      fetchCycles,
      loading,
      currentYear,
      isCurrentYear
    }}>
      {children}
    </CycleContext.Provider>
  )
}

export function useCycle() {
  const ctx = useContext(CycleContext)
  return ctx ?? {
    cycles: [],
    activeCycleId: null,
    activeCycle: null,
    setActiveCycleId: () => {},
    fetchCycles: () => {},
    loading: false,
    currentYear: new Date().getFullYear(),
    isCurrentYear: () => false
  }
}
