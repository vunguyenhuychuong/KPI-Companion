import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * The de xuat TAO KPI MOI tu Tro ly AI — nguoi dung chinh sua roi Xac nhan.
 * Khong co gi duoc ghi vao he thong truoc khi bam Xac nhan (human-in-the-loop).
 */
export default function KpiProposal({ kpis: proposedKpis, weightChanges, onConfirmed, onDismiss }) {
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
        🆕 Đề xuất tạo {rows.length} KPI mới — kiểm tra và chỉnh sửa trước khi lưu
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
              <option value="">— Chưa gắn mục tiêu —</option>
              {objectives.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <label className="delta-label" title="Chỉ tiêu số + đơn vị đo">
              <input type="number" step="any" min="0" style={{ width: 60 }} value={r.target_value}
                onChange={(e) => update(i, 'target_value', e.target.value)} />
              <input style={{ width: 84 }} value={r.unit}
                onChange={(e) => update(i, 'unit', e.target.value)} />
            </label>
            <label className="delta-label" title="Trọng số % trong mục tiêu">
              ⚖
              <input type="number" min="0" max="100" value={r.weight}
                onChange={(e) => update(i, 'weight', e.target.value)} />
              %
            </label>
            <label className="delta-label" title="Deadline">
              <input type="date" value={r.deadline || ''}
                onChange={(e) => update(i, 'deadline', e.target.value || null)} />
            </label>
            <button className="btn-icon" title="Bỏ KPI này" onClick={() => removeRow(i)}>✕</button>
          </div>
        </div>
      ))}

      {changes.length > 0 && (
        <div className="proposal-card">
          <div className="proposal-ref" style={{ marginBottom: 6 }}>
            ⚖️ Điều chỉnh trọng số KPI hiện có (để tổng nhóm = 100%):
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
              <button className="btn-icon" title="Bỏ điều chỉnh này" onClick={() => removeChange(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="error-text">⚠️ {error}</div>}
      <div className="proposal-actions">
        <button className="btn primary" disabled={saving || !rows.length} onClick={confirm}>
          {saving ? 'Đang lưu…' : `Xác nhận tạo ${rows.length} KPI`}
        </button>
        {onDismiss && <button className="btn ghost" onClick={onDismiss}>Bỏ qua</button>}
      </div>
    </div>
  )
}
