import { createContext, useCallback, useContext, useState } from 'react'
import { useLang } from '../LangContext'
import { UiIcon } from './UiIcon'

const ToastContext = createContext(null)

let _nextId = 0

const ICONS = { success: 'checkCircle', error: 'xCircle', warning: 'warning', info: 'info' }

export function ToastProvider({ children }) {
  const { tr } = useLang()
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t))
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300)
  }, [])

  const add = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++_nextId
    setToasts((prev) => [...prev, { id, message, type, exiting: false }])
    setTimeout(() => dismiss(id), duration)
  }, [dismiss])

  const toast = {
    success: (msg, duration) => add(msg, 'success', duration),
    error:   (msg, duration) => add(msg, 'error',   duration ?? 6000),
    warning: (msg, duration) => add(msg, 'warning', duration),
    info:    (msg, duration) => add(msg, 'info',    duration),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}${t.exiting ? ' toast-exit' : ''}`} role="alert">
            <span className="toast-icon" aria-hidden="true"><UiIcon name={ICONS[t.type]} /></span>
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label={tr('common.close')}><UiIcon name="x" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
