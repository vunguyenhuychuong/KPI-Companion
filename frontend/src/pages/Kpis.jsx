import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'

const EMPTY = { name: '', description: '', target: '', weight: 10, year: 2026, deadline: '' }

export default function Kpis() {
  const { tr } = useLang()
  const [kpis, setKpis] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [changelog, setChangelog] = useState({})
  const [error, setError] = useState('')
  const [conflicts, setConflicts] = useState(null) // null = chưa phân tích
  const [analyzing, setAnalyzing] = useState(false)
  const fileRef = useRef(null)

  const load = () => api.listKpis().then(setKpis).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.createKpi({ ...form, weight: Number(form.weight), deadline: form.deadline || null })
      setForm(EMPTY)
      setShowForm(false)
      load()
    } catch (err) { setError(err.message) }
  }

  const importFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const created = await api.importKpis(file)
      alert(tr('kpis.import_success', { count: created.length }))
      load()
    } catch (err) { setError(err.message) } finally { e.target.value = '' }
  }

  const decompose = async (id) => {
    setBusyId(id)
    setError('')
    try {
      await api.decomposeKpi(id)
      await load()
      setExpanded(id)
    } catch (err) { setError(err.message) } finally { setBusyId(null) }
  }

  const archive = async (kpi) => {
    const reason = prompt(tr('kpis.archive_prompt', { name: kpi.name }))
    if (reason === null) return
    await api.deleteKpi(kpi.id, reason)
    load()
  }

  const editWeight = async (kpi) => {
    const w = prompt(tr('kpis.weight_prompt', { name: kpi.name, weight: kpi.weight }))
    if (w === null || isNaN(Number(w))) return
    const reason = prompt(tr('kpis.reason_prompt')) || ''
    await api.updateKpi(kpi.id, { weight: Number(w), reason })
    load()
  }

  const analyzeConflicts = async () => {
    setAnalyzing(true)
    setError('')
    try {
      const res = await api.analyzeConflicts()
      setConflicts(res.conflicts)
    } catch (err) { setError(err.message) } finally { setAnalyzing(false) }
  }

  const conflictKpiIds = new Set((conflicts || []).flatMap((c) => c.kpi_ids))

  const toggleLog = async (id) => {
    if (changelog[id]) { setChangelog((c) => ({ ...c, [id]: null })); return }
    const logs = await api.kpiChangelog(id)
    setChangelog((c) => ({ ...c, [id]: logs }))
  }

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>{tr('kpis.title')}</h1>
          <p>{tr('kpis.subtitle')}</p>
        </div>
        <div className="header-actions">
          <button className="btn" disabled={analyzing || kpis.length < 2} onClick={analyzeConflicts}>
          {analyzing ? '⏳ Agent đang rà soát…' : '⚔️ Phát hiện xung đột'}
        </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>{tr('kpis.btn_import')}</button>

          <button className="btn" onClick={() => fileRef.current?.click()}>📤 Import Excel/CSV</button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={importFile} />
          <button className="btn primary" onClick={() => setShowForm(!showForm)}>{tr('kpis.btn_add')}</button>
        </div>
      </header>

      {error && <div className="error-text">⚠️ {error}</div>}

      {conflicts !== null && (
        <div className={`card conflict-panel ${conflicts.length ? 'has-conflicts' : ''}`}>
          <div className="row">
            <h3>⚔️ Kết quả rà soát xung đột KPI</h3>
            <button className="btn small ghost" onClick={() => setConflicts(null)}>Đóng</button>
          </div>
          {conflicts.length === 0 ? (
            <p className="muted">✅ Không phát hiện xung đột nào giữa các KPI hiện tại. Bộ KPI của bạn nhất quán!</p>
          ) : conflicts.map((c, i) => (
            <div key={i} className={`conflict-item sev-${c.severity}`}>
              <div className="conflict-head">
                <span className={`sev-badge sev-${c.severity}`}>
                  {c.severity === 'high' ? '🔴 Nghiêm trọng' : c.severity === 'medium' ? '🟠 Đáng kể' : '🟡 Lưu ý'}
                </span>
                <strong>{c.kpi_names.join(' ↔ ')}</strong>
              </div>
              <p><b>Vì sao xung đột:</b> {c.explanation}</p>
              {c.suggestion && <p className="conflict-suggestion">💡 <b>Gợi ý cân bằng:</b> {c.suggestion}</p>}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <form className="card kpi-form" onSubmit={submit}>
          <input required placeholder={tr('kpis.placeholder_name')} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder={tr('kpis.placeholder_desc')} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input placeholder={tr('kpis.placeholder_target')} value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })} />
          <div className="form-row">
            <label>{tr('kpis.weight_label')}
              <input type="number" min="0" max="100" value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </label>
            <label>{tr('kpis.deadline_label')}
              <input type="date" value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </label>
            <button className="btn primary" type="submit">{tr('kpis.save_btn')}</button>
          </div>
        </form>
      )}

      {kpis.map((kpi) => (
        <div className={`card kpi-row${conflictKpiIds.has(kpi.id) ? ' in-conflict' : ''}`} key={kpi.id}>
          <div className="kpi-row-head">
            <div>
              <strong>{kpi.name}</strong>
              {conflictKpiIds.has(kpi.id) && <span className="conflict-tag">⚔️ Có xung đột</span>}
              <div className="kpi-meta">
                {kpi.target && <>🎯 {kpi.target} · </>}
                {tr('kpis.meta', { weight: kpi.weight, deadline: kpi.deadline || `${kpi.year}-12-31`, progress: kpi.progress })}
              </div>
            </div>
            <div className="kpi-row-actions">
              <button className="btn small" disabled={busyId === kpi.id} onClick={() => decompose(kpi.id)}>
                {busyId === kpi.id ? tr('kpis.agent_decomposing') : kpi.sub_goals?.length ? tr('kpis.redecompose_btn') : tr('kpis.decompose_btn')}
              </button>
              {kpi.sub_goals?.length > 0 && (
                <button className="btn small ghost" onClick={() => setExpanded(expanded === kpi.id ? null : kpi.id)}>
                  {expanded === kpi.id ? tr('kpis.collapse') : tr('kpis.view_subgoals', { count: kpi.sub_goals.length })}
                </button>
              )}
              <button className="btn small ghost" onClick={() => editWeight(kpi)}>{tr('kpis.edit_weight')}</button>
              <button className="btn small ghost" onClick={() => toggleLog(kpi.id)}>{tr('kpis.changelog')}</button>
              <button className="btn small danger" onClick={() => archive(kpi)}>{tr('kpis.archive')}</button>
            </div>
          </div>

          {expanded === kpi.id && kpi.sub_goals?.length > 0 && (
            <div className="subgoals">
              {['quarter', 'month'].map((pt) => (
                <div key={pt}>
                  <h4>{pt === 'quarter' ? tr('kpis.quarter') : tr('kpis.month')}</h4>
                  <ul>
                    {kpi.sub_goals.filter((s) => s.period_type === pt).map((s) => (
                      <li key={s.id}>
                        <b>{s.period_label}</b>: {s.description}
                        <span className="muted"> {tr('kpis.expected_progress', { value: s.expected_progress })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {changelog[kpi.id] && (
            <div className="changelog">
              <h4>{tr('kpis.changelog_title')}</h4>
              {changelog[kpi.id].length === 0 ? <p className="muted">{tr('kpis.no_changelog')}</p> : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{tr('kpis.col_date')}</th>
                      <th>{tr('kpis.col_field')}</th>
                      <th>{tr('kpis.col_old')}</th>
                      <th>{tr('kpis.col_new')}</th>
                      <th>{tr('kpis.col_reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changelog[kpi.id].map((l) => (
                      <tr key={l.id}>
                        <td>{l.changed_at?.slice(0, 10)}</td><td>{l.field}</td>
                        <td>{l.old_value}</td><td>{l.new_value}</td><td>{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
