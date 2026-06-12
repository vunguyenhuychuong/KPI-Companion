import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'

const EMPTY = {
  name: '', description: '', target: '', weight: 10, year: 2026, deadline: '',
  objective_id: '', unit: '%', target_value: 100,
}

const num = (v) => parseFloat(String(v).replace(',', '.').replace('%', ''))

function WeightHint({ total, label, tr }) {
  if (total === null || isNaN(total)) return null
  const cls = total > 100 ? 'red' : total === 100 ? 'green' : 'yellow'
  return (
    <div className={`weight-hint ${cls}`}>
      {label}: <b>{Math.round(total * 10) / 10}%</b> / 100%
      {total > 100 && tr('wh.over')}
      {total === 100 && tr('wh.ok')}
      {total < 100 && tr('wh.left', { left: Math.round((100 - total) * 10) / 10 })}
    </div>
  )
}

/* ===== Modal tao / sua Objective (co trong so) ===== */
function ObjectiveModal({ objective, objectives, onClose, onSaved, tr }) {
  const isNew = !objective?.id
  const [f, setF] = useState({
    name: objective?.name || '',
    description: objective?.description || '',
    weight: String(objective?.weight ?? 0),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const w = num(f.weight)
  const wValid = !isNaN(w) && w >= 0 && w <= 100
  const totalOthers = objectives
    .filter((o) => o.id !== objective?.id)
    .reduce((s, o) => s + (o.weight || 0), 0)
  const newTotal = wValid ? totalOthers + w : null

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = { name: f.name.trim(), description: f.description, weight: w }
      if (isNew) await api.createObjective(payload)
      else await api.updateObjective(objective.id, payload)
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? tr('objm.add') : tr('objm.edit')}</h3>
        <label className="modal-field">{tr('objm.name')}
          <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="modal-field">{tr('kpim.desc')}
          <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <label className="modal-field">{tr('objm.weight')}
          <input type="number" min="0" max="100" value={f.weight}
            onChange={(e) => setF({ ...f, weight: e.target.value })} />
        </label>
        <WeightHint total={newTotal} label={tr('wh.obj_total')} tr={tr} />
        {error && <div className="error-text">⚠️ {error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>{tr('kpim.cancel')}</button>
          <button className="btn primary"
            disabled={saving || !f.name.trim() || !wValid || (newTotal !== null && newTotal > 100)}
            onClick={save}>
            {saving ? tr('kpim.saving') : tr('kpim.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ===== Modal sua KPI day du ===== */
function EditKpiModal({ kpi, kpis, objectives, onClose, onSaved, tr }) {
  const [f, setF] = useState({
    name: kpi.name,
    description: kpi.description || '',
    target: kpi.target || '',
    weight: String(kpi.weight),
    deadline: kpi.deadline || '',
    unit: kpi.unit || '%',
    target_value: String(kpi.target_value),
    current_value: String(kpi.current_value),
    objective_id: kpi.objective_id ?? '',
  })
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  const w = num(f.weight)
  const tv = num(f.target_value)
  const cv = num(f.current_value)
  const wValid = !isNaN(w) && w >= 0 && w <= 100
  const tvValid = !isNaN(tv) && tv > 0
  const cvValid = !isNaN(cv) && cv >= 0
  const progressPreview = tvValid && cvValid ? Math.round((cv / tv) * 1000) / 10 : null

  // tong trong so KPI trong NHOM DICH (muc tieu duoc chon trong form)
  const targetObjId = f.objective_id === '' ? null : Number(f.objective_id)
  const groupTotal = wValid
    ? kpis
        .filter((k) => k.id !== kpi.id && (k.objective_id ?? null) === targetObjId)
        .reduce((s, k) => s + (k.weight || 0), 0) + w
    : null
  const over = groupTotal !== null && groupTotal > 100
  const groupName = targetObjId
    ? objectives.find((o) => o.id === targetObjId)?.name
    : tr('kpis.ungrouped_plain')

  const changed =
    f.name !== kpi.name || f.description !== (kpi.description || '') ||
    f.target !== (kpi.target || '') || (wValid && w !== kpi.weight) ||
    f.deadline !== (kpi.deadline || '') || f.unit !== (kpi.unit || '%') ||
    (tvValid && tv !== kpi.target_value) || (cvValid && cv !== kpi.current_value) ||
    String(f.objective_id) !== String(kpi.objective_id ?? '')
  const currentChanged = cvValid && cv !== kpi.current_value

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: f.name.trim(), description: f.description, target: f.target,
        weight: w, deadline: f.deadline || null,
        unit: f.unit.trim() || '%', target_value: tv, current_value: cv,
        reason: reason.trim(),
      }
      if (f.objective_id === '') payload.clear_objective = true
      else payload.objective_id = Number(f.objective_id)
      await api.updateKpi(kpi.id, payload)
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('kpim.title')}</h3>
        <p className="modal-kpi-name">{tr('kpim.note')}</p>

        <label className="modal-field">{tr('kpim.name')}
          <input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="modal-field">{tr('kpim.desc')}
          <input value={f.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        <label className="modal-field">{tr('kpim.target')}
          <input value={f.target} onChange={(e) => set('target', e.target.value)} />
        </label>
        <label className="modal-field">{tr('kpim.objective')}
          <select value={f.objective_id} onChange={(e) => set('objective_id', e.target.value)}>
            <option value="">{tr('kpim.none_obj')}</option>
            {objectives.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>

        <div className="modal-grid">
          <label className="modal-field">{tr('kpim.unit')}
            <input placeholder="%, khóa học, báo cáo…" value={f.unit}
              onChange={(e) => set('unit', e.target.value)} />
          </label>
          <label className="modal-field">{tr('kpim.target_value')}
            <input type="number" min="0" step="any" value={f.target_value}
              onChange={(e) => set('target_value', e.target.value)} />
          </label>
          <label className="modal-field">{tr('kpim.current_value')}
            <input type="number" min="0" step="any" value={f.current_value}
              onChange={(e) => set('current_value', e.target.value)} />
          </label>
        </div>
        <div className="modal-grid">
          <label className="modal-field">{tr('kpis.deadline_label')}
            <input type="date" value={f.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </label>
          <label className="modal-field">{tr('kpim.weight')}
            <input type="number" min="0" max="100" value={f.weight}
              onChange={(e) => set('weight', e.target.value)} />
          </label>
          <div className="modal-field">{tr('kpim.progress_auto')}
            <div className="progress-preview">
              {progressPreview === null ? '—' : `${cv}/${tv} ${f.unit} = ${progressPreview}%`}
              {progressPreview > 100 && <span className="over-badge">{tr('kpis.over_badge')}</span>}
            </div>
          </div>
        </div>

        {w !== kpi.weight || targetObjId !== (kpi.objective_id ?? null) ? (
          <WeightHint total={groupTotal} label={tr('wh.kpi_group', { name: groupName })} tr={tr} />
        ) : null}
        {currentChanged && (
          <div className="weight-hint yellow">
            {tr('kpim.manual_warning', { old: kpi.current_value, new: cv, unit: f.unit })}
          </div>
        )}

        <label className="modal-field">{tr('kpim.reason')} <b>{tr('kpim.reason_required')}</b>
          <input placeholder={tr('kpim.reason_ph')}
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>

        {error && <div className="error-text">⚠️ {error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>{tr('kpim.cancel')}</button>
          <button
            className="btn primary"
            disabled={saving || !changed || !f.name.trim() || !wValid || !tvValid || !cvValid || over || !reason.trim()}
            onClick={save}
          >
            {saving ? tr('kpim.saving') : tr('kpim.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ kpi, busyId, expanded, changelog, actions, inConflict, tr }) {
  const over = kpi.progress > 100
  const measure = kpi.unit === '%'
    ? <>{tr('kpis.actual')} <b>{kpi.current_value}%</b></>
    : <>{tr('kpis.actual')} <b>{kpi.current_value}/{kpi.target_value} {kpi.unit}</b> ({kpi.progress}%)</>
  return (
    <div className={`card kpi-row${inConflict ? ' in-conflict' : ''}`}>
      <div className="kpi-card-grid">
        <div className="kpi-main">
          <div className="kpi-title-line">
            <strong>{kpi.name}</strong>
            {over && <span className="over-badge">{tr('kpis.over_badge')}</span>}
            {inConflict && <span className="conflict-tag">⚔️ Có xung đột</span>}
          </div>
          <div className="kpi-meta">
            {kpi.target && <span className="meta-seg">🎯 {kpi.target}</span>}
            <span className="meta-seg">{measure}</span>
            <span className="meta-seg">{tr('kpis.meta_weight', { weight: kpi.weight })}</span>
            <span className="meta-seg">⏳ {kpi.deadline || `${kpi.year}-12-31`}</span>
          </div>
          <div className="progress-track mini">
            <div className="progress-fill gradient" style={{ width: `${Math.min(100, kpi.progress)}%` }} />
          </div>
        </div>
        <div className="kpi-actions">
          <button
            className={`icon-btn ${busyId === kpi.id ? 'spinning' : ''}`}
            disabled={busyId === kpi.id}
            title={busyId === kpi.id ? tr('kpis.agent_decomposing') : tr('kpis.tip_decompose')}
            onClick={() => actions.decompose(kpi.id)}
          >✨</button>
          {kpi.sub_goals?.length > 0 && (
            <button className={`icon-btn ${expanded === kpi.id ? 'on' : ''}`}
              title={tr('kpis.view_subgoals', { count: kpi.sub_goals.length })}
              onClick={() => actions.toggleExpand(kpi.id)}>📋</button>
          )}
          <button className="icon-btn" title={tr('kpis.tip_edit')} onClick={() => actions.edit(kpi)}>✏️</button>
          <button className={`icon-btn ${changelog[kpi.id] ? 'on' : ''}`} title={tr('kpis.changelog_title')} onClick={() => actions.toggleLog(kpi.id)}>🕒</button>
          <button className="icon-btn danger" title={tr('kpis.tip_archive')} onClick={() => actions.archive(kpi)}>🗑</button>
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
                  <th>{tr('kpis.col_time')}</th>
                  <th>{tr('kpis.col_field')}</th>
                  <th>{tr('kpis.col_old')}</th>
                  <th>{tr('kpis.col_new')}</th>
                  <th>{tr('kpis.col_reason')}</th>
                </tr>
              </thead>
              <tbody>
                {changelog[kpi.id].map((l) => (
                  <tr key={l.id}>
                    <td className="nowrap">{l.changed_at?.slice(0, 16).replace('T', ' ')}</td><td>{l.field}</td>
                    <td>{l.old_value}</td><td>{l.new_value}</td><td>{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default function Kpis() {
  const { tr } = useLang()
  const [kpis, setKpis] = useState([])
  const [objectives, setObjectives] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [changelog, setChangelog] = useState({})
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [objModal, setObjModal] = useState(null) // null | {} (tao moi) | objective
  const [conflicts, setConflicts] = useState(null) // null = chưa phân tích
  const [analyzing, setAnalyzing] = useState(false)
  const fileRef = useRef(null)

  const load = () =>
    Promise.all([api.listKpis(), api.listObjectives()])
      .then(([k, o]) => { setKpis(k); setObjectives(o) })
      .catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const totalObjWeight = Math.round(objectives.reduce((s, o) => s + (o.weight || 0), 0) * 10) / 10

  // tong trong so KPI trong nhom dich cua form tao moi
  const formObjId = form.objective_id === '' ? null : Number(form.objective_id)
  const formW = num(form.weight) || 0
  const formGroupTotal =
    kpis.filter((k) => (k.objective_id ?? null) === formObjId).reduce((s, k) => s + (k.weight || 0), 0) + formW

  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.createKpi({
        ...form,
        weight: Number(form.weight),
        target_value: Number(form.target_value) || 100,
        deadline: form.deadline || null,
        objective_id: form.objective_id ? Number(form.objective_id) : null,
      })
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

  const analyzeConflicts = async () => {
    setAnalyzing(true)
    setError('')
    try {
      const res = await api.analyzeConflicts()
      setConflicts(res.conflicts)
    } catch (err) { setError(err.message) } finally { setAnalyzing(false) }
  }

  const conflictKpiIds = new Set((conflicts || []).flatMap((c) => c.kpi_ids))

  const removeObjective = async (o) => {
    if (!confirm(tr('kpis.obj_remove_confirm', { name: o.name }))) return
    await api.deleteObjective(o.id)
    load()
  }

  const actions = {
    decompose: async (id) => {
      setBusyId(id)
      setError('')
      try {
        await api.decomposeKpi(id)
        await load()
        setExpanded(id)
      } catch (err) { setError(err.message) } finally { setBusyId(null) }
    },
    archive: async (kpi) => {
      const reason = prompt(tr('kpis.archive_prompt', { name: kpi.name }))
      if (reason === null) return
      await api.deleteKpi(kpi.id, reason)
      load()
    },
    edit: (kpi) => setEditing(kpi),
    toggleExpand: (id) => setExpanded(expanded === id ? null : id),
    toggleLog: async (id) => {
      if (changelog[id]) { setChangelog((c) => ({ ...c, [id]: null })); return }
      const logs = await api.kpiChangelog(id)
      setChangelog((c) => ({ ...c, [id]: logs }))
    },
  }

  const groups = [
    ...objectives.map((o) => ({ obj: o, kpis: kpis.filter((k) => k.objective_id === o.id) })),
    { obj: null, kpis: kpis.filter((k) => !k.objective_id) },
  ].filter((g) => g.obj || g.kpis.length > 0)

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>{tr('kpis.title')}</h1>
          <p>
            {tr('kpis.subtitle')}{' '}
            <span className={`weight-total ${totalObjWeight > 100 ? 'red' : totalObjWeight === 100 ? 'green' : 'yellow'}`}>
              {tr('kpis.weight_total_badge', { total: totalObjWeight })}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <button className="btn" disabled={analyzing || kpis.length < 2} onClick={analyzeConflicts}>
            {analyzing ? '⏳ Agent đang rà soát…' : '⚔️ Phát hiện xung đột'}
          </button>
          <a className="btn" href={api.exportUrl}>{tr('kpis.btn_export')}</a>
          <button className="btn" onClick={() => fileRef.current?.click()}>{tr('kpis.btn_import')}</button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={importFile} />
          <button className="btn" onClick={() => setObjModal({})}>{tr('kpis.btn_add_obj')}</button>
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
          <input placeholder={tr('kpis.placeholder_target')} value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })} />
          <div className="form-row">
            <label>{tr('kpis.form_objective')}
              <select value={form.objective_id} onChange={(e) => setForm({ ...form, objective_id: e.target.value })}>
                <option value="">{tr('kpis.form_none')}</option>
                {objectives.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label>{tr('kpis.form_unit')}
              <input style={{ width: 110 }} placeholder="%, khóa học…" value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </label>
            <label>{tr('kpis.form_target_value')}
              <input type="number" min="0" step="any" style={{ width: 100 }} value={form.target_value}
                onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
            </label>
            <label>{tr('kpis.weight_label')}
              <input type="number" min="0" max="100" style={{ width: 90 }} value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </label>
            <label>{tr('kpis.deadline_label')}
              <input type="date" value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </label>
            <button className="btn primary" type="submit" disabled={formGroupTotal > 100}>{tr('kpis.save_btn')}</button>
          </div>
          {formW > 0 && (
            <WeightHint total={formGroupTotal} tr={tr}
              label={tr('wh.kpi_group', { name: formObjId ? objectives.find((o) => o.id === formObjId)?.name : tr('kpis.ungrouped_plain') })} />
          )}
        </form>
      )}

      {editing && (
        <EditKpiModal kpi={editing} kpis={kpis} objectives={objectives} tr={tr}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
      {objModal && (
        <ObjectiveModal objective={objModal.id ? objModal : null} objectives={objectives} tr={tr}
          onClose={() => setObjModal(null)} onSaved={() => { setObjModal(null); load() }} />
      )}

      {groups.map(({ obj, kpis: groupKpis }) => {
        const sumW = Math.round(groupKpis.reduce((s, k) => s + (k.weight || 0), 0) * 10) / 10
        const sumCls = sumW === 100 ? 'green' : sumW > 100 ? 'red' : 'yellow'
        const balance = async () => {
          if (!confirm(tr('kpis.balance_confirm', { count: groupKpis.length }))) return
          try {
            await api.balanceWeights(obj?.id ?? null)
            load()
          } catch (e) { setError(e.message) }
        }
        return (
          <section className="objective-group" key={obj?.id ?? 'none'}>
            <div className="objective-head">
              <div className="objective-title">
                <h2>{obj ? `🏁 ${obj.name}` : tr('kpis.ungrouped')}</h2>
                {obj && (
                  <span className="obj-stats">
                    <span className="obj-stat">{tr('kpis.obj_weight')} <b>{obj.weight}%</b></span>
                    <span className="obj-stat"><b>{obj.kpi_count}</b> KPI</span>
                    <span className="obj-stat">{tr('kpis.obj_progress')} <b>{obj.progress}%</b></span>
                  </span>
                )}
                {groupKpis.length > 0 && (
                  <span className={`sum-chip ${sumCls}`} title={tr('kpis.sum_chip_tip')}>
                    Σ KPI: {sumW}/100%
                    {sumW !== 100 && (
                      <button className="balance-btn" title={tr('kpis.balance_tip')} onClick={balance}>
                        {tr('kpis.balance_btn')}
                      </button>
                    )}
                  </span>
                )}
              </div>
              {obj && (
                <div className="objective-bar-wrap">
                  <div className="progress-track objective-bar">
                    <div className="progress-fill gradient" style={{ width: `${Math.min(100, obj.progress)}%` }} />
                  </div>
                  <button className="icon-btn" title={tr('objm.edit')} onClick={() => setObjModal(obj)}>✏️</button>
                  <button className="icon-btn danger" title={tr('kpis.obj_remove_tip')} onClick={() => removeObjective(obj)}>✕</button>
                </div>
              )}
            </div>
            {groupKpis.length === 0 ? (
              <p className="muted objective-empty">{tr('kpis.group_empty')}</p>
            ) : (
              groupKpis.map((kpi) => (
                <KpiCard key={kpi.id} kpi={kpi} busyId={busyId} expanded={expanded} tr={tr}
                  changelog={changelog} actions={actions} inConflict={conflictKpiIds.has(kpi.id)} />
              ))
            )}
          </section>
        )
      })}
    </div>
  )
}
