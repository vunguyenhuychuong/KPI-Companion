import { useEffect, useState } from 'react'
import { STATUS_COLORS, SOURCE_LABELS, api } from '../api'
import { useLang } from '../LangContext'
import NumberStepper from './NumberStepper'
import { UiIcon, cleanIconLabel } from './UiIcon'

export default function ProposalList({ items, onConfirmed, onDismiss }) {
  const { tr, statusLabels, sourceLabels } = useLang()
  const SL = statusLabels()
  const SRC = sourceLabels()

  const [rows, setRows] = useState(items)
  const [kpis, setKpis] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setRows(items) }, [items])
  useEffect(() => { api.listKpis().then(setKpis).catch(() => {}) }, [])

  if (!rows?.length) return null

  const update = (i, field, value) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }
  const remove = (i) => setRows(rows.filter((_, idx) => idx !== i))
  const deltaOf = (r) => r.value_delta ?? r.progress_delta ?? 0

  const confirm = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = rows.map((r) => ({ ...r, value_delta: Number(deltaOf(r)) || 0 }))
      await api.confirmItems(payload)
      onConfirmed?.(payload)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="proposal-box">
      <div className="proposal-header">
        {tr('proposal.header', { count: rows.length })}
      </div>
      {rows.map((r, i) => (
        <div className="proposal-card" key={i}>
          <div className="proposal-main">
            <input
              className="proposal-title"
              value={r.title}
              onChange={(e) => update(i, 'title', e.target.value)}
            />
            {r.source_ref && <div className="proposal-ref"><UiIcon name="paperclip" /> {r.source_ref}</div>}
            {(r.mapping_reason || r.confidence != null || r.alternative_kpis?.length > 0) && (
              <div className="proposal-ref proposal-reason">
                <UiIcon name="sparkles" />
                {r.mapping_reason || tr('proposal.reason_fallback')}
                {r.confidence != null && (
                  <span className="proposal-confidence">
                    {tr('proposal.confidence', { value: Math.round(Number(r.confidence) * 100) })}
                  </span>
                )}
              </div>
            )}
            {r.alternative_kpis?.length > 0 && (
              <div className="proposal-alt">
                <span>{tr('proposal.alternatives')}</span>
                {r.alternative_kpis.map((alt) => (
                  <button
                    type="button"
                    className="proposal-alt-btn"
                    key={alt.kpi_id}
                    title={alt.reason || alt.kpi_name}
                    onClick={() => update(i, 'kpi_id', alt.kpi_id)}
                  >
                    {alt.kpi_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="proposal-controls">
            <select
              value={r.status}
              style={{ borderColor: STATUS_COLORS[r.status], color: STATUS_COLORS[r.status] }}
              onChange={(e) => update(i, 'status', e.target.value)}
            >
              {Object.entries(SL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={r.kpi_id ?? ''}
              onChange={(e) => update(i, 'kpi_id', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{tr('proposal.no_kpi')}</option>
              {kpis.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
            <label className="delta-label">
              +
              <NumberStepper
                min="0"
                max="100"
                className="compact"
                value={deltaOf(r)}
                onChange={(value) => update(i, 'value_delta', value)}
              />
              <span className="delta-unit">{r.kpi_unit || '%'}</span>
            </label>
            <span className="source-badge">{cleanIconLabel(SRC[r.source] ?? SOURCE_LABELS[r.source] ?? r.source)}</span>
            <button className="btn-icon" title={tr('proposal.remove_item')} onClick={() => remove(i)}><UiIcon name="x" /></button>
          </div>
        </div>
      ))}
      {error && <div className="error-text">{error}</div>}
      <div className="proposal-actions">
        <button className="btn primary" disabled={saving || !rows.length} onClick={confirm}>
          <UiIcon name="check" />{saving ? tr('proposal.saving') : tr('proposal.confirm', { count: rows.length })}
        </button>
        {onDismiss && (
          <button className="btn ghost" onClick={onDismiss}><UiIcon name="x" />{tr('proposal.dismiss_all')}</button>
        )}
      </div>
    </div>
  )
}
