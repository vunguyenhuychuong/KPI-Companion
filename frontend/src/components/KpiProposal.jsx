import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'

/**
 * The de xuat tu Tro ly AI: tao Objective MOI (neu co) + KPI gan vao.
 * Dung thu tu he thong: Objective co truoc -> KPI thuoc Objective.
 * Khong co gi duoc luu truoc khi nguoi dung bam Xac nhan.
 */
export default function KpiProposal({ kpis: proposedKpis, newObjectives, weightChanges, onConfirmed, onDismiss }) {
  const { tr } = useLang()
  const [rows, setRows] = useState(proposedKpis)
  const [newObjs, setNewObjs] = useState(newObjectives || [])
  const [changes, setChanges] = useState(weightChanges || [])
  const [objectives, setObjectives] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setRows(proposedKpis)
    setNewObjs(newObjectives || [])
    setChanges(weightChanges || [])
  }, [proposedKpis, newObjectives, weightChanges])
  useEffect(() => { api.listObjectives().then(setObjectives).catch(() => {}) }, [])

  if (!rows?.length && !newObjs?.length) return null

  const update = (i, field, value) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  const updateObj = (i, field, value) =>
    setNewObjs(newObjs.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)))
  const updateChange = (i, value) =>
    setChanges(changes.map((c, idx) => (idx === i ? { ...c, new_weight: Number(value) || 0 } : c)))
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i))
  const removeChange = (i) => setChanges(changes.filter((_, idx) => idx !== i))
  const removeObj = (i) => {
    const name = newObjs[i]?.name
    setNewObjs(newObjs.filter((_, idx) => idx !== i))
    // KPI dang tham chieu muc tieu vua bo -> chuyen ve "chua gan"
    setRows(rows.map((r) => (r.objective_ref === name ? { ...r, objective_ref: null, objective_name: null } : r)))
  }

  // gia tri cua select: id muc tieu cu (so) hoac "new:<ten>" cho muc tieu moi
  const selectValue = (r) => (r.objective_ref ? `new:${r.objective_ref}` : (r.objective_id ?? ''))
  const onSelect = (i, v) => {
    if (v.startsWith('new:')) {
      const name = v.slice(4)
      setRows(rows.map((r, idx) => (idx === i
        ? { ...r, objective_ref: name, objective_name: name, objective_id: null } : r)))
    } else {
      setRows(rows.map((r, idx) => (idx === i
        ? { ...r, objective_ref: null, objective_id: v ? Number(v) : null } : r)))
    }
  }

  const confirm = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        objectives: newObjs.map((o) => ({ ...o, weight: Number(o.weight) || 0 })),
        kpis: rows.map((r) => ({
          ...r,
          weight: Number(r.weight) || 0,
          target_value: Number(r.target_value) || 100,
          objective_id: r.objective_ref ? null : (r.objective_id ? Number(r.objective_id) : null),
        })),
        weight_changes: changes,
      }
      await api.confirmKpiProposal(payload)
      onConfirmed?.()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="proposal-box">
      <div className="proposal-header">
        {tr('kpi_proposal.header', { count: rows.length })}
      </div>

      {newObjs.length > 0 && (
        <div className="proposal-card">
          <div className="proposal-ref" style={{ marginBottom: 6 }}>
            {tr('kpi_proposal.new_objectives')}
          </div>
          {newObjs.map((o, i) => (
            <div className="proposal-controls" key={i}>
              <span>🏁</span>
              <input className="proposal-title" style={{ flex: 1, minWidth: 160 }} value={o.name}
                onChange={(e) => updateObj(i, 'name', e.target.value)} />
              <label className="delta-label" title={tr('kpi_proposal.obj_weight_tooltip')}>
                ⚖
                <input type="number" min="0" max="100" value={o.weight}
                  onChange={(e) => updateObj(i, 'weight', e.target.value)} />
                %
              </label>
              <button className="btn-icon" title={tr('kpi_proposal.remove_obj')} onClick={() => removeObj(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {rows.map((r, i) => (
        <div className="proposal-card" key={i}>
          <div className="proposal-main">
            <input className="proposal-title" value={r.name}
              onChange={(e) => update(i, 'name', e.target.value)} />
            {r.target && <div className="proposal-ref">🎯 {r.target}</div>}
          </div>
          <div className="proposal-controls">
            <select value={selectValue(r)} onChange={(e) => onSelect(i, e.target.value)}>
              <option value="">{tr('kpi_proposal.no_objective')}</option>
              {newObjs.map((o) => (
                <option key={`new:${o.name}`} value={`new:${o.name}`}>🆕 {o.name}</option>
              ))}
              {objectives.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <label className="delta-label" title={tr('kpi_proposal.target_tooltip')}>
              <input type="number" step="any" min="0" style={{ width: 60 }} value={r.target_value}
                onChange={(e) => update(i, 'target_value', e.target.value)} />
              <input style={{ width: 84 }} value={r.unit}
                onChange={(e) => update(i, 'unit', e.target.value)} />
            </label>
            <label className="delta-label" title={tr('kpi_proposal.weight_tooltip')}>
              ⚖
              <input type="number" min="0" max="100" value={r.weight}
                onChange={(e) => update(i, 'weight', e.target.value)} />
              %
            </label>
            <label className="delta-label" title={tr('kpi_proposal.deadline_tooltip')}>
              <input type="date" value={r.deadline || ''}
                onChange={(e) => update(i, 'deadline', e.target.value || null)} />
            </label>
            <button className="btn-icon" title={tr('kpi_proposal.remove_kpi')} onClick={() => removeRow(i)}>✕</button>
          </div>
        </div>
      ))}

      {changes.length > 0 && (
        <div className="proposal-card">
          <div className="proposal-ref" style={{ marginBottom: 6 }}>
            {tr('kpi_proposal.adjust_weights')}
          </div>
          {changes.map((c, i) => (
            <div className="proposal-controls" key={c.kpi_id}>
              <span style={{ fontSize: 13 }}>{c.kpi_name}</span>
              <span className="muted">{c.old_weight}% →</span>
              <label className="delta-label">
                <input type="number" min="0" max="100" value={c.new_weight}
                  onChange={(e) => updateChange(i, e.target.value)} />
                %
              </label>
              <button className="btn-icon" title={tr('kpi_proposal.remove_change')} onClick={() => removeChange(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="error-text">⚠️ {error}</div>}
      <div className="proposal-actions">
        <button className="btn primary" disabled={saving || (!rows.length && !newObjs.length)} onClick={confirm}>
          {saving ? tr('kpi_proposal.saving') : tr('kpi_proposal.confirm', { count: rows.length })}
        </button>
        {onDismiss && <button className="btn ghost" onClick={onDismiss}>{tr('kpi_proposal.dismiss')}</button>}
      </div>
    </div>
  )
}
