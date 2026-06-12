import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'
import { useLang } from '../LangContext'

function now() { return new Date() }

export default function Reports() {
  const { tr } = useLang()

  const PERIODS = [
    { key: 'week', label: tr('reports.tab_week') },
    { key: 'month', label: tr('reports.tab_month') },
    { key: 'quarter', label: tr('reports.tab_quarter') },
    { key: 'year', label: tr('reports.tab_year') },
  ]

  const [saved, setSaved] = useState([])
  const [periodType, setPeriodType] = useState('week')
  const [weekDate, setWeekDate] = useState(now().toISOString().slice(0, 10))
  const [month, setMonth] = useState(`${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}`)
  const [quarter, setQuarter] = useState(`Q${Math.floor(now().getMonth() / 3) + 1}/${now().getFullYear()}`)
  const [year, setYear] = useState(String(now().getFullYear()))
  const [busy, setBusy] = useState(false)
  const [secs, setSecs] = useState(0)
  const [viewing, setViewing] = useState(null)
  const [error, setError] = useState('')

  const load = () => api.savedReports().then(setSaved).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!busy) { setSecs(0); return }
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const label = periodType === 'week' ? weekDate
        : periodType === 'month' ? month
        : periodType === 'quarter' ? quarter
        : year
      const report = await api.generateReport(periodType, label)
      setViewing(report)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const regenerate = async () => {
    if (!viewing) return
    setBusy(true)
    setError('')
    try {
      const report = await api.regenerateReport(viewing.id)
      setViewing(report)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const remove = async (e, id) => {
    e.stopPropagation()
    if (!confirm(tr('reports.delete_confirm'))) return
    await api.deleteReport(id)
    if (viewing?.id === id) setViewing(null)
    load()
  }

  const copy = () => {
    navigator.clipboard.writeText(viewing.content)
      .then(() => alert(tr('reports.copy_success')))
  }

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>{tr('reports.title')}</h1>
          <p>{tr('reports.subtitle')}</p>
        </div>
        <a className="btn" href={api.exportUrl}>{tr('reports.export')}</a>
      </header>

      <div className="card report-controls">
        <div className="period-tabs">
          {PERIODS.map((p) => (
            <button key={p.key}
              className={`period-tab ${periodType === p.key ? 'active' : ''}`}
              onClick={() => setPeriodType(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="form-row">
          {periodType === 'week' && (
            <label>{tr('reports.label_week')}
              <input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value)} />
            </label>
          )}
          {periodType === 'month' && (
            <label>{tr('reports.label_month')}
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          )}
          {periodType === 'quarter' && (
            <label>{tr('reports.label_quarter')}
              <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                {[now().getFullYear() - 1, now().getFullYear()].flatMap((y) =>
                  [1, 2, 3, 4].map((q) => (
                    <option key={`${q}-${y}`} value={`Q${q}/${y}`}>Q{q}/{y}</option>
                  )),
                )}
              </select>
            </label>
          )}
          {periodType === 'year' && (
            <label>{tr('reports.label_year')}
              <input type="number" style={{ width: 100 }} value={year} onChange={(e) => setYear(e.target.value)} />
            </label>
          )}
          <button className="btn primary" onClick={generate} disabled={busy}>
            {busy ? tr('reports.generating', { secs }) : tr('reports.generate_btn')}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}
          dangerouslySetInnerHTML={{ __html: marked.parseInline(tr('reports.overwrite_note')) }}
        />
      </div>

      {error && <div className="error-text">⚠️ {error}</div>}

      <div className="report-layout">
        <div className="report-list">
          <h3 className="muted">{tr('reports.list_title')}</h3>
          {saved.length === 0 && <p className="muted">{tr('reports.no_reports')}</p>}
          {saved.map((r) => (
            <div key={r.id}
              className={`report-item ${viewing?.id === r.id ? 'active' : ''}`}
              onClick={() => setViewing(r)}>
              <div>
                <b>{r.period_label}</b>
                <div className="muted">{r.created_at?.slice(0, 16).replace('T', ' ')}</div>
              </div>
              <button className="btn-icon" title={tr('reports.delete_title')} onClick={(e) => remove(e, r.id)}>✕</button>
            </div>
          ))}
        </div>

        <div className="report-view card">
          {viewing ? (
            <>
              <div className="report-view-head">
                <span className="muted">{tr('reports.updated_at', { time: viewing.created_at?.slice(0, 16).replace('T', ' ') })}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn small" onClick={regenerate} disabled={busy}
                    title={tr('reports.regenerate_tooltip')}>
                    {busy ? tr('reports.regenerating', { secs }) : tr('reports.regenerate_btn')}
                  </button>
                  <button className="btn small" onClick={copy}>{tr('reports.copy_btn')}</button>
                </div>
              </div>
              <div className="report-content" dangerouslySetInnerHTML={{ __html: marked.parse(viewing.content) }} />
            </>
          ) : (
            <p className="muted"
              dangerouslySetInnerHTML={{ __html: marked.parseInline(tr('reports.empty_view')) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
