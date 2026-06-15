import { useEffect, useMemo, useState } from 'react'
import { api, STATUS_COLORS } from '../api'
import { useLang } from '../LangContext'
import { ConfirmModal } from '../components/Modal'
import { useToast } from '../components/Toast'

function EvidenceTab() {
  const { tr, statusLabels, sourceLabels } = useLang()
  const SL = statusLabels()
  const SRC = sourceLabels()

  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { api.listWorkItems().then(setItems).catch(() => {}) }, [])

  const filtered = useMemo(() => items.filter((w) =>
    (!status || w.status === status) &&
    (!source || w.source === source) &&
    (!search || (w.title + (w.kpi_name || '') + w.source_ref).toLowerCase().includes(search.toLowerCase()))
  ), [items, status, source, search])

  return (
    <>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <label>{tr('journal.filter_status')}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tr('journal.filter_all')}</option>
            {Object.entries(SL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>{tr('journal.filter_source')}
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{tr('journal.filter_all')}</option>
            {Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ flex: 1 }}>{tr('journal.filter_search')}
          <input placeholder={tr('journal.search_placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <span className="muted">{tr('journal.count', { filtered: filtered.length, total: items.length })}</span>
      </div>
      <div className="card">
        {filtered.length === 0 ? <p className="muted">{tr('journal.no_match')}</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>{tr('journal.col_work_date')}</th>
                <th>{tr('journal.col_recorded')}</th>
                <th>{tr('journal.col_task')}</th>
                <th>{tr('journal.col_status')}</th>
                <th>{tr('journal.col_kpi')}</th>
                <th>{tr('journal.col_delta')}</th>
                <th>{tr('journal.col_source')}</th>
                <th>{tr('journal.col_origin')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id}>
                  <td className="nowrap">{w.work_date || <span className="muted">—</span>}</td>
                  <td className="nowrap muted">{w.created_at?.slice(0, 19).replace('T', ' ')}</td>
                  <td>{w.title}</td>
                  <td><span className="status-chip" style={{ color: STATUS_COLORS[w.status] }}>{SL[w.status] ?? w.status}</span></td>
                  <td>{w.kpi_name || <span className="muted">{tr('journal.no_kpi')}</span>}</td>
                  <td>{w.progress_delta ? `${w.progress_delta > 0 ? '+' : ''}${w.progress_delta}` : '—'}</td>
                  <td className="nowrap">{SRC[w.source] ?? w.source}</td>
                  <td className="muted">{w.source_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function HistoryTab() {
  const { tr } = useLang()
  const [restorePending, setRestorePending] = useState(null)

  const FIELD_LABELS = {
    name: tr('journal.field_name'),
    description: tr('journal.field_description'),
    target: tr('journal.field_target'),
    weight: tr('journal.field_weight'),
    deadline: tr('journal.field_deadline'),
    unit: tr('journal.field_unit'),
    target_value: tr('journal.field_target_value'),
    current_value: tr('journal.field_current_value'),
    progress: tr('journal.field_progress'),
    objective: tr('journal.field_objective'),
    archived: tr('journal.field_archived'),
  }

  const [logs, setLogs] = useState([])
  const [archived, setArchived] = useState([])
  const [error, setError] = useState('')

  const load = () =>
    Promise.all([api.allChangelog(), api.archivedKpis()])
      .then(([l, a]) => { setLogs(l); setArchived(a) })
      .catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const doRestore = async () => {
    if (!restorePending) return
    try {
      await api.restoreKpi(restorePending.id)
      setRestorePending(null)
      load()
    } catch (e) { setError(e.message) }
  }

  return (
    <>
      {error && <div className="error-text">⚠️ {error}</div>}
      {archived.length > 0 && (
        <div className="card">
          <h3>{tr('journal.archived_kpis', { count: archived.length })}</h3>
          {archived.map((k) => (
            <div className="todo-row" key={k.id}>
              <div className="todo-main">
                <span className="todo-title">{k.name}</span>
                <span className="muted">
                  {k.unit === '%' ? `Actual ${k.current_value}%` : `Actual ${k.current_value}/${k.target_value} ${k.unit}`}
                  {k.objective_name ? ` · 🏁 ${k.objective_name}` : ''}
                </span>
              </div>
              <button className="btn small" onClick={() => setRestorePending(k)}>{tr('journal.restore')}</button>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <h3>{tr('journal.changelog_all', { count: logs.length })}</h3>
        {logs.length === 0 ? <p className="muted">{tr('journal.no_changes')}</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>{tr('journal.col_time')}</th>
                <th>{tr('journal.col_kpi_name')}</th>
                <th>{tr('journal.col_field')}</th>
                <th>{tr('journal.col_old')}</th>
                <th>{tr('journal.col_new')}</th>
                <th>{tr('journal.col_reason')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{l.changed_at?.slice(0, 19).replace('T', ' ')}</td>
                  <td>{l.kpi_name || `#${l.kpi_id}`}</td>
                  <td className="nowrap">{FIELD_LABELS[l.field] || l.field}</td>
                  <td>{l.old_value}</td>
                  <td><b>{l.new_value}</b></td>
                  <td className="muted">{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ConfirmModal
        open={!!restorePending}
        title={tr('journal.restore')}
        message={restorePending ? tr('journal.restore_confirm', { name: restorePending.name }) : ''}
        confirmLabel={tr('journal.restore')}
        onConfirm={doRestore}
        onCancel={() => setRestorePending(null)}
      />
    </>
  )
}

export default function Journal() {
  const { tr } = useLang()
  const toast = useToast()
  const [tab, setTab] = useState('evidence')
  return (
    <div className="page journal-page">
      <header className="page-header row">
        <div>
          <h1>{tr('journal.title')}</h1>
          <p>{tr('journal.subtitle')}</p>
        </div>
        <button className="btn" onClick={() => api.exportEvaluation().catch((e) => toast.error(e.message))}>
          {tr('journal.export')}
        </button>
      </header>
      <div className="period-tabs">
        <button className={`period-tab ${tab === 'evidence' ? 'active' : ''}`} onClick={() => setTab('evidence')}>
          {tr('journal.tab_evidence')}
        </button>
        <button className={`period-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          {tr('journal.tab_history')}
        </button>
      </div>
      {tab === 'evidence' ? <EvidenceTab /> : <HistoryTab />}
    </div>
  )
}
