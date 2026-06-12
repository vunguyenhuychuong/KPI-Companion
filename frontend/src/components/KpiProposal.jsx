import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'

export default function KpiProposal({ kpis: proposedKpis, weightChanges, onConfirmed, onDismiss }) {
  const { tr } = useLang()
  const [rows, setRows] = useState(proposedKpis)
  const [changes, setChanges] = useState(weightChanges || [])
  const [objectives, setObjectives] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setRows(proposedKpis); setChanges(weightChanges || []) }, [proposedKpis, weightChanges])
  useEffect(() => { api.listObjectives().then(setObjectives).catch(() => {}) }, [])

  if (!rows?.length) return null

  const update = (i, field, value) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  const updateChange = (i, value) =>
    setChanges(changes.map((c, idx) => (idx === i ? { ...c, new_weight: Number(value) || 0 } : c)))
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i))
  const removeChange = (i) => setChanges(changes.filter((_, idx) => idx !== i))

  const confirm = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        kpis: rows.map((r) => ({
          ...r,
          weight: Number(r.weight) || 0,
          target_value: Number(r.target_value) || 100,
          objective_id: r.objective_id ? Number(r.objective_id) : null,
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
      {rows.map((r, i) => (
        <div className="proposal-card" key={i}>
          <div className="proposal-main">
            <input className="proposal-title" value={r.name}
              onChange={(e) => update(i, 'name', e.target.value)} />
            {r.target && <div className="proposal-ref">🎯 {r.target}</div>}
          </div>
          <div className="proposal-controls">
            <select value={r.objective_id ?? ''}
              onChange={(e) => update(i, 'objective_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{tr('kpi_proposal.no_objective')}</option>
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
        <button className="btn primary" disabled={saving || !rows.length} onClick={confirm}>
          {saving ? tr('kpi_proposal.saving') : tr('kpi_proposal.confirm', { count: rows.length })}
        </button>
        {onDismiss && <button className="btn ghost" onClick={onDismiss}>{tr('kpi_proposal.dismiss')}</button>}
      </div>
    </div>
  )
}
