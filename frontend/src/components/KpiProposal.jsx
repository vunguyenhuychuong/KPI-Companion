import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'
import NumberStepper from './NumberStepper'
import { UiIcon, cleanIconLabel } from './UiIcon'

const normalizeNumericInput = (value, { min = 0, max = Infinity, integer = false } = {}) => {
  if (value === '') return ''
  const raw = String(value).replace(',', '.').replace('%', '').trim()
  if (!raw || raw === '-' || raw === '.' || raw === '-.') return ''
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return ''
  const numeric = integer ? Math.trunc(parsed) : parsed
  return String(Math.min(max, Math.max(min, numeric)))
}
const normalizeWeightInput = (value) => normalizeNumericInput(value, { min: 0, max: 100, integer: true })
const normalizeNonNegativeInput = (value) => normalizeNumericInput(value, { min: 0 })

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
  const updateObj = (i, field, value) => {
    const oldName = newObjs[i]?.name
    setNewObjs(newObjs.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)))
    if (field === 'category' && oldName) {
      setRows(rows.map((r) => (r.objective_ref === oldName ? { ...r, category: value } : r)))
    }
  }
  const updateChange = (i, value) =>
    setChanges(changes.map((c, idx) => (idx === i ? { ...c, new_weight: normalizeWeightInput(value) } : c)))
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
      const obj = newObjs.find((o) => o.name === name)
      setRows(rows.map((r, idx) => (idx === i
        ? { ...r, objective_ref: name, objective_name: name, objective_id: null, category: obj?.category || r.category || 'Work' } : r)))
    } else {
      const obj = objectives.find((o) => String(o.id) === String(v))
      setRows(rows.map((r, idx) => (idx === i
        ? { ...r, objective_ref: null, objective_id: v ? Number(v) : null, category: obj?.category || r.category || 'Work' } : r)))
    }
  }

  const validWeight = (v) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 && n <= 100
  }
  const validPositive = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0
  }
  const hasInvalidNumbers =
    newObjs.some((o) => !validWeight(o.weight)) ||
    rows.some((r) => !validWeight(r.weight) || !validPositive(r.target_value)) ||
    changes.some((c) => !validWeight(c.new_weight))

  const confirm = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        objectives: newObjs.map((o) => ({ ...o, weight: Number(o.weight) || 0 })),
        kpis: rows.map((r) => ({
          ...r,
          weight: Number(r.weight) || 0,
          target_value: Number(r.target_value),
          objective_id: r.objective_ref ? null : (r.objective_id ? Number(r.objective_id) : null),
        })),
        weight_changes: changes.map((c) => ({ ...c, new_weight: Number(c.new_weight) || 0 })),
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
            <UiIcon name="flag" /> {cleanIconLabel(tr('kpi_proposal.new_objectives'))}
          </div>
          {newObjs.map((o, i) => (
            <div className="proposal-controls" key={i}>
              <span className="inline-ui-icon"><UiIcon name="flag" /></span>
              <input className="proposal-title" style={{ flex: 1, minWidth: 160 }} value={o.name}
                onChange={(e) => updateObj(i, 'name', e.target.value)} />
              <label className="delta-label" title={tr('kpi_proposal.obj_weight_tooltip')}>
                <UiIcon name="scale" />
                <NumberStepper min="0" max="100" step="1" className="compact" value={o.weight}
                  onChange={(value) => updateObj(i, 'weight', normalizeWeightInput(value))} />
                %
              </label>
              <select value={o.category || 'Work'} onChange={(e) => updateObj(i, 'category', e.target.value)}>
                <option value="Work">{cleanIconLabel(tr('category.work'))}</option>
                <option value="Personal">{cleanIconLabel(tr('category.personal'))}</option>
              </select>
              <button className="btn-icon" title={tr('kpi_proposal.remove_obj')} onClick={() => removeObj(i)}><UiIcon name="x" /></button>
            </div>
          ))}
        </div>
      )}

      {rows.map((r, i) => (
        <div className="proposal-card" key={i}>
          <div className="proposal-main">
            <input className="proposal-title" value={r.name}
              onChange={(e) => update(i, 'name', e.target.value)} />
            {r.target && <div className="proposal-ref"><UiIcon name="target" /> {r.target}</div>}
          </div>
          <div className="proposal-controls">
            <select value={selectValue(r)} onChange={(e) => onSelect(i, e.target.value)}>
              <option value="">{tr('kpi_proposal.no_objective')}</option>
              {newObjs.map((o) => (
                <option key={`new:${o.name}`} value={`new:${o.name}`}>{o.name}</option>
              ))}
              {objectives.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <label className="delta-label" title={tr('kpi_proposal.target_tooltip')}>
              <NumberStepper step="any" min="0" className="compact" value={r.target_value}
                onChange={(value) => update(i, 'target_value', normalizeNonNegativeInput(value))} />
              <input style={{ width: 84 }} value={r.unit}
                onChange={(e) => update(i, 'unit', e.target.value)} />
            </label>
            <label className="delta-label" title={tr('kpi_proposal.weight_tooltip')}>
              <UiIcon name="scale" />
              <NumberStepper min="0" max="100" step="1" className="compact" value={r.weight}
                onChange={(value) => update(i, 'weight', normalizeWeightInput(value))} />
              %
            </label>
            <label className="delta-label" title={tr('kpi_proposal.deadline_tooltip')}>
              <input type="date" value={r.deadline || ''}
                onChange={(e) => update(i, 'deadline', e.target.value || null)} />
            </label>
            <select value={r.category || 'Work'} onChange={(e) => update(i, 'category', e.target.value)}>
              <option value="Work">{cleanIconLabel(tr('category.work'))}</option>
              <option value="Personal">{cleanIconLabel(tr('category.personal'))}</option>
            </select>
            <button className="btn-icon" title={tr('kpi_proposal.remove_kpi')} onClick={() => removeRow(i)}><UiIcon name="x" /></button>
          </div>
        </div>
      ))}

      {changes.length > 0 && (
        <div className="proposal-card">
          <div className="proposal-ref" style={{ marginBottom: 6 }}>
            <UiIcon name="scale" /> {cleanIconLabel(tr('kpi_proposal.adjust_weights'))}
          </div>
          {changes.map((c, i) => (
            <div className="proposal-controls" key={c.kpi_id}>
              <span style={{ fontSize: 13 }}>{c.kpi_name}</span>
              <span className="muted">{c.old_weight}% {'->'}</span>
              <label className="delta-label">
                <NumberStepper min="0" max="100" step="1" className="compact" value={c.new_weight}
                  onChange={(value) => updateChange(i, value)} />
                %
              </label>
              <button className="btn-icon" title={tr('kpi_proposal.remove_change')} onClick={() => removeChange(i)}><UiIcon name="x" /></button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
      <div className="proposal-actions">
        <button className="btn primary" disabled={saving || hasInvalidNumbers || (!rows.length && !newObjs.length)} onClick={confirm}>
          <UiIcon name="check" />{saving ? tr('kpi_proposal.saving') : tr('kpi_proposal.confirm', { count: rows.length })}
        </button>
        {onDismiss && <button className="btn ghost" onClick={onDismiss}><UiIcon name="x" />{tr('kpi_proposal.dismiss')}</button>}
      </div>
    </div>
  )
}
