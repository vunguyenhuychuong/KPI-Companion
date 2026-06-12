import { createContext, useContext, useState } from 'react'
import { translations } from './i18n'

const LangContext = createContext(null)

const WORK_STATUSES = ['da_lam', 'dang_lam', 'se_lam', 'phat_sinh', 'loai_bo']
const SOURCES = ['chat', 'csv', 'gmail', 'calendar', 'sheets']

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('kpi_lang') || 'vi')

  function toggleLang() {
    const next = lang === 'vi' ? 'en' : 'vi'
    setLang(next)
    localStorage.setItem('kpi_lang', next)
  }

  return <LangContext.Provider value={{ lang, toggleLang }}>{children}</LangContext.Provider>
}

export function useLang() {
  const ctx = useContext(LangContext)
  const lang = ctx?.lang ?? 'vi'
  const toggleLang = ctx?.toggleLang ?? (() => {})

  function tr(key, vars = {}) {
    const str = translations[lang]?.[key] ?? translations.vi?.[key] ?? key
    const entries = Object.entries(vars)
    if (!entries.length) return str
    return entries.reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v ?? '')), str)
  }

  // returns { da_lam: 'Done', ... } in the current language — for select dropdowns
  function statusLabels() {
    return Object.fromEntries(WORK_STATUSES.map(k => [k, tr('status.' + k)]))
  }

  // returns { chat: '💬 Chat', ... } in the current language
  function sourceLabels() {
    return Object.fromEntries(SOURCES.map(k => [k, tr('source.' + k)]))
  }

  return { lang, tr, toggleLang, statusLabels, sourceLabels }
}
