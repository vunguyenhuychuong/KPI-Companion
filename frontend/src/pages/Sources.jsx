import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'
import ProposalList from '../components/ProposalList'

function lastMonday() {
  const d = new Date()
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

export default function Sources() {
  const { tr } = useLang()

  const SOURCES = [
    { key: 'gmail', label: '✉️ Gmail', descKey: 'sources.source_gmail_desc' },
    { key: 'calendar', label: '📅 Google Calendar', descKey: 'sources.source_calendar_desc' },
    { key: 'sheets', label: '📊 Google Sheets', descKey: 'sources.source_sheets_desc' },
  ]

  const [status, setStatus] = useState(null)
  const [selected, setSelected] = useState(['gmail', 'calendar', 'sheets'])
  const [start, setStart] = useState(lastMonday())
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { api.sourcesStatus().then(setStatus).catch(() => {}) }, [])

  const toggle = (key) =>
    setSelected((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]))

  const sync = async () => {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await api.syncSources({ sources: selected, start_date: start, end_date: end })
      setResult(res)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await api.uploadWorklog(file)
      setResult(res)
    } catch (err) { setError(err.message) } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{tr('sources.title')}</h1>
        <p>{tr('sources.subtitle')}</p>
      </header>

      {status && (
        <div className={`mode-banner ${status.gmail === 'mock' ? 'mock' : 'real'}`}>
          {status.gmail === 'mock'
            ? tr('sources.demo_banner', { note: status.note })
            : tr('sources.real_banner')}
        </div>
      )}

      <div className="card">
        <h3>{tr('sources.google_section')}</h3>
        <div className="source-list">
          {SOURCES.map((s) => (
            <label key={s.key} className={`source-item ${selected.includes(s.key) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected.includes(s.key)} onChange={() => toggle(s.key)} />
              <div>
                <div className="source-name">{s.label}</div>
                <div className="muted">{tr(s.descKey)}</div>
              </div>
              {status && (
                <span className={`badge ${status[s.key]}`}>
                  {status[s.key] === 'mock' ? tr('sources.demo_badge') : tr('sources.real_badge')}
                </span>
              )}
            </label>
          ))}
        </div>
        <div className="form-row">
          <label>{tr('sources.from_date')} <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>{tr('sources.to_date')} <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <button className="btn primary" onClick={sync} disabled={busy || selected.length === 0}>
            {busy ? tr('sources.scanning') : tr('sources.scan_btn')}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>{tr('sources.upload_section')}</h3>
        <p className="muted">{tr('sources.upload_desc')}</p>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>{tr('sources.upload_btn')}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={upload} />
      </div>

      {error && <div className="error-text">⚠️ {error}</div>}

      {result && (
        <div className="card">
          <p>{result.reply}</p>
          {result.proposed_items?.length > 0 ? (
            <ProposalList
              items={result.proposed_items}
              onConfirmed={() => setResult({ ...result, proposed_items: [], reply: tr('sources.success') })}
              onDismiss={() => setResult(null)}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
