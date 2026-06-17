import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useLang } from '../LangContext'
import { useView, matchView } from '../ViewContext'
import { useCycle } from '../CycleContext'
import ViewModeSwitch from '../components/ViewModeSwitch'
import KpiChangeHistory from '../components/KpiChangeHistory'
import { ConfirmModal, Modal, PromptModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import NumberStepper from '../components/NumberStepper'
import { UiIcon, cleanIconLabel } from '../components/UiIcon'

const EMPTY = {
  name: '', description: '', target: '', weight: 10, year: 2026, deadline: '',
  objective_id: '', unit: '%', target_value: 100, category: 'Work',
  cadence: 'monthly', target_mode: 'same',
  warning_threshold: 80, critical_threshold: 70, trend_drop_periods: 3, alert_muted_until: '',
}

const num = (v) => parseFloat(String(v).replace(',', '.').replace('%', ''))
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
const normalizePercentInput = (value) => normalizeNumericInput(value, { min: 0, max: 100 })
const normalizeTrendInput = (value) => normalizeNumericInput(value, { min: 2, max: 12, integer: true })
const CADENCES = ['weekly', 'monthly', 'quarterly']
const TARGET_MODES = ['same', 'period_custom']
const pad2 = (n) => String(n).padStart(2, '0')

function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function cyclePreset(preset, baseYear, tr) {
  const now = new Date()
  if (preset === 'next_year') {
    const year = baseYear + 1
    return { name: tr('onboarding.cycle.year_name', { year }), cycle_type: 'yearly', start_date: `${year}-01-01`, end_date: `${year}-12-31` }
  }
  if (preset === 'quarterly') {
    const q = Math.floor(now.getMonth() / 3) + 1
    const startMonth = (q - 1) * 3
    const start = new Date(baseYear, startMonth, 1)
    const end = new Date(baseYear, startMonth + 3, 0)
    return { name: tr('onboarding.cycle.quarter_name', { q, year: baseYear }), cycle_type: 'quarterly', start_date: isoDate(start), end_date: isoDate(end) }
  }
  if (preset === 'monthly') {
    const start = new Date(baseYear, now.getMonth(), 1)
    const end = new Date(baseYear, now.getMonth() + 1, 0)
    return { name: tr('onboarding.cycle.month_name', { month: pad2(now.getMonth() + 1), year: baseYear }), cycle_type: 'monthly', start_date: isoDate(start), end_date: isoDate(end) }
  }
  return { name: tr('onboarding.cycle.year_name', { year: baseYear }), cycle_type: 'yearly', start_date: `${baseYear}-01-01`, end_date: `${baseYear}-12-31` }
}

function currentPeriodKey(periodType = 'monthly') {
  const d = new Date()
  const year = d.getFullYear()
  if (periodType === 'weekly') {
    const tmp = new Date(Date.UTC(year, d.getMonth(), d.getDate()))
    const day = tmp.getUTCDay() || 7
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
    const isoYear = tmp.getUTCFullYear()
    const yearStart = new Date(Date.UTC(isoYear, 0, 1))
    const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7)
    return `${isoYear}-W${String(week).padStart(2, '0')}`
  }
  if (periodType === 'quarterly') return `${year}-Q${Math.floor(d.getMonth() / 3) + 1}`
  return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

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
function ObjectiveModal({ objective, objectives, cycleId, onClose, onSaved, tr }) {
  const isNew = !objective?.id
  const [f, setF] = useState({
    name: objective?.name || '',
    description: objective?.description || '',
    weight: String(objective?.weight ?? 0),
    category: objective?.category || 'Work',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const w = num(f.weight)
  const wValid = !isNaN(w) && Number.isInteger(w) && w >= 0 && w <= 100
  const totalOthers = objectives
    .filter((o) => o.id !== objective?.id)
    .filter((o) => (o.category || 'Work') === f.category)
    .reduce((s, o) => s + (o.weight || 0), 0)
  const newTotal = wValid ? totalOthers + w : null

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = { name: f.name.trim(), description: f.description, weight: w, category: f.category }
      if (isNew && cycleId) payload.cycle_id = cycleId
      if (isNew) await api.createObjective(payload)
      else await api.updateObjective(objective.id, payload)
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{cleanIconLabel(isNew ? tr('objm.add') : tr('objm.edit'))}</h3>
        <label className="modal-field">{tr('objm.name')}
          <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="modal-field">{tr('kpim.desc')}
          <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <label className="modal-field">{tr('objm.weight')}
          <NumberStepper min="0" max="100" step="1" value={f.weight}
            onChange={(value) => setF({ ...f, weight: normalizeWeightInput(value) })} />
        </label>
        <label className="modal-field">{tr('kpim.category')}
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="Work">{cleanIconLabel(tr('category.work'))}</option>
            <option value="Personal">{cleanIconLabel(tr('category.personal'))}</option>
          </select>
        </label>
        <WeightHint total={newTotal} label={tr('wh.obj_total')} tr={tr} />
        {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}><UiIcon name="x" />{tr('kpim.cancel')}</button>
          <button className="btn primary"
            disabled={saving || !f.name.trim() || !wValid || (newTotal !== null && newTotal > 100)}
            onClick={save}>
            <UiIcon name="check" />{saving ? tr('kpim.saving') : tr('kpim.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function NewCycleModal({ currentYear, onClose, onCreated, tr }) {
  const initial = cyclePreset('yearly', currentYear, tr)
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const applyPreset = (preset) => {
    setF(cyclePreset(preset, currentYear, tr))
    setError('')
  }

  const save = async () => {
    if (!f.name.trim()) {
      setError(tr('onboarding.err_cycle_name'))
      return
    }
    if (f.start_date && f.end_date && f.start_date > f.end_date) {
      setError(tr('onboarding.err_cycle_dates'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const cycle = await api.createCycle({
        name: f.name.trim(),
        cycle_type: f.cycle_type,
        start_date: f.start_date || null,
        end_date: f.end_date || null,
      })
      onCreated(cycle)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal clone-cycle-modal" onClick={e => e.stopPropagation()}>
        <h3 className="icon-heading"><UiIcon name="calendar" /> {tr('cycle.create')}</h3>
        <p className="muted">{tr('cycle.create_desc')}</p>
        <div className="onboarding-preset-row">
          <button className="btn small ghost" type="button" onClick={() => applyPreset('yearly')}>{tr('onboarding.preset_this_year')}</button>
          <button className="btn small ghost" type="button" onClick={() => applyPreset('next_year')}>{tr('onboarding.preset_next_year')}</button>
          <button className="btn small ghost" type="button" onClick={() => applyPreset('quarterly')}>{tr('onboarding.preset_current_quarter')}</button>
          <button className="btn small ghost" type="button" onClick={() => applyPreset('monthly')}>{tr('onboarding.preset_current_month')}</button>
        </div>
        <label className="modal-field">{tr('onboarding.cycle_kind')}
          <select value={f.cycle_type} onChange={e => setF({ ...f, cycle_type: e.target.value })}>
            <option value="yearly">{tr('onboarding.cycle_kind_year')}</option>
            <option value="quarterly">{tr('onboarding.cycle_kind_quarter')}</option>
            <option value="monthly">{tr('onboarding.cycle_kind_month')}</option>
            <option value="custom">{tr('onboarding.cycle_kind_custom')}</option>
          </select>
        </label>
        <label className="modal-field">{tr('cycle.clone_new_name')}
          <input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        </label>
        <div className="clone-date-row">
          <label className="modal-field">{tr('cycle.start_date')}
            <input type="date" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} />
          </label>
          <label className="modal-field">{tr('cycle.end_date')}
            <input type="date" value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} />
          </label>
        </div>
        {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>{tr('common.cancel')}</button>
          <button className="btn primary" disabled={saving || !f.name.trim()} onClick={save}>
            {saving ? tr('cycle.creating') : tr('cycle.create_new')}
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
    category: kpi.category || 'Work',
    cadence: kpi.cadence || 'monthly',
    target_mode: kpi.target_mode || 'same',
    warning_threshold: String(kpi.warning_threshold ?? 80),
    critical_threshold: String(kpi.critical_threshold ?? 70),
    trend_drop_periods: String(kpi.trend_drop_periods ?? 3),
    alert_muted_until: kpi.alert_muted_until || '',
  })
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [serverTotal, setServerTotal] = useState(null)
  const svTimerRef = useRef(null)

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  const w = num(f.weight)
  const tv = num(f.target_value)
  const cv = num(f.current_value)
  const warning = num(f.warning_threshold)
  const critical = num(f.critical_threshold)
  const trendPeriods = num(f.trend_drop_periods)
  const wValid = !isNaN(w) && Number.isInteger(w) && w >= 0 && w <= 100
  const tvValid = !isNaN(tv) && tv > 0
  const cvValid = !isNaN(cv) && cv >= 0
  const thresholdsValid = !isNaN(warning) && !isNaN(critical) && warning >= 0 && warning <= 100 && critical >= 0 && critical <= warning
  const trendValid = Number.isInteger(trendPeriods) && trendPeriods >= 2 && trendPeriods <= 12
  const progressPreview = tvValid && cvValid ? Math.round((cv / tv) * 1000) / 10 : null

  // tong trong so KPI trong NHOM DICH (muc tieu duoc chon trong form)
  const targetObjId = f.objective_id === '' ? null : Number(f.objective_id)
  const groupTotal = wValid
    ? kpis
        .filter((k) => k.id !== kpi.id && (k.objective_id ?? null) === targetObjId)
        .filter((k) => targetObjId !== null || (k.category || 'Work') === f.category)
        .reduce((s, k) => s + (k.weight || 0), 0) + w
    : null
  // server xac nhan lai tong moi nhat (400ms debounce) — uu tien khi co du lieu
  const displayTotal = serverTotal ?? groupTotal
  const over = displayTotal !== null && displayTotal > 100

  useEffect(() => {
    if (!wValid) { setServerTotal(null); return }
    clearTimeout(svTimerRef.current)
    svTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.validateKpiWeights(targetObjId, w, kpi.id, f.category)
        setServerTotal(res.projected_total)
      } catch { setServerTotal(null) }
    }, 400)
    return () => clearTimeout(svTimerRef.current)
  }, [w, targetObjId, wValid, f.category])
  const groupName = targetObjId
    ? objectives.find((o) => o.id === targetObjId)?.name
    : tr('kpis.ungrouped_plain')

  const changed =
    f.name !== kpi.name || f.description !== (kpi.description || '') ||
    f.target !== (kpi.target || '') || (wValid && w !== kpi.weight) ||
    f.deadline !== (kpi.deadline || '') || f.unit !== (kpi.unit || '%') ||
    (tvValid && tv !== kpi.target_value) || (cvValid && cv !== kpi.current_value) ||
    String(f.objective_id) !== String(kpi.objective_id ?? '') ||
    f.category !== (kpi.category || 'Work') ||
    f.cadence !== (kpi.cadence || 'monthly') ||
    f.target_mode !== (kpi.target_mode || 'same') ||
    (thresholdsValid && warning !== (kpi.warning_threshold ?? 80)) ||
    (thresholdsValid && critical !== (kpi.critical_threshold ?? 70)) ||
    (trendValid && trendPeriods !== (kpi.trend_drop_periods ?? 3)) ||
    f.alert_muted_until !== (kpi.alert_muted_until || '')
  const currentChanged = cvValid && cv !== kpi.current_value

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: f.name.trim(), description: f.description, target: f.target,
        weight: w, deadline: f.deadline || null,
        unit: f.unit.trim() || '%', target_value: tv, current_value: cv,
        category: f.category,
        cadence: f.cadence,
        target_mode: f.target_mode,
        warning_threshold: warning,
        critical_threshold: critical,
        trend_drop_periods: trendPeriods,
        alert_muted_until: f.alert_muted_until || null,
        reason: reason.trim(),
      }
      if (f.objective_id === '') payload.clear_objective = true
      else payload.objective_id = Number(f.objective_id)
      await api.updateKpi(kpi.id, payload)
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{cleanIconLabel(tr('kpim.title'))}</h3>
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
          <select value={f.objective_id} onChange={(e) => {
            const value = e.target.value
            const obj = objectives.find((o) => String(o.id) === String(value))
            setF((s) => ({ ...s, objective_id: value, category: obj?.category || s.category }))
          }}>
            <option value="">{tr('kpim.none_obj')}</option>
            {objectives.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="modal-field">{tr('kpim.category')}
          <select value={f.category} onChange={(e) => set('category', e.target.value)}>
            <option value="Work">{cleanIconLabel(tr('category.work'))}</option>
            <option value="Personal">{cleanIconLabel(tr('category.personal'))}</option>
          </select>
        </label>

        <div className="modal-grid">
          <label className="modal-field">{tr('kpim.unit')}
            <input placeholder={tr('kpis.unit_placeholder')} value={f.unit}
              onChange={(e) => set('unit', e.target.value)} />
          </label>
          <label className="modal-field">{tr('kpim.target_value')}
            <NumberStepper min="0" step="any" value={f.target_value}
              onChange={(value) => set('target_value', normalizeNonNegativeInput(value))} />
          </label>
          <label className="modal-field">{tr('kpim.current_value')}
            <NumberStepper min="0" step="any" value={f.current_value}
              onChange={(value) => set('current_value', normalizeNonNegativeInput(value))} />
          </label>
        </div>
        <div className="modal-grid">
          <label className="modal-field">{tr('kpis.deadline_label')}
            <input type="date" value={f.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </label>
          <label className="modal-field">{tr('kpim.weight')}
            <NumberStepper min="0" max="100" step="1" value={f.weight}
              onChange={(value) => set('weight', normalizeWeightInput(value))} />
          </label>
          <div className="modal-field">{tr('kpim.progress_auto')}
            <div className="progress-preview">
              {progressPreview === null ? '—' : `${cv}/${tv} ${f.unit} = ${progressPreview}%`}
              {progressPreview > 100 && <span className="over-badge">{tr('kpis.over_badge')}</span>}
            </div>
          </div>
        </div>
        <div className="modal-section-title">{tr('input.measurement_title')}</div>
        <div className="modal-grid modal-grid-two">
          <label className="modal-field">{tr('input.cadence')}
            <select value={f.cadence} onChange={(e) => set('cadence', e.target.value)}>
              {CADENCES.map((opt) => <option key={opt} value={opt}>{tr(`input.cadence_${opt}`)}</option>)}
            </select>
          </label>
          <label className="modal-field">{tr('input.target_mode')}
            <select value={f.target_mode} onChange={(e) => set('target_mode', e.target.value)}>
              {TARGET_MODES.map((opt) => <option key={opt} value={opt}>{tr(`input.target_${opt}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="modal-section-title">{tr('input.alerts_title')}</div>
        <div className="modal-grid">
          <label className="modal-field">{tr('input.warning_threshold')}
            <NumberStepper min="0" max="100" step="1" value={f.warning_threshold}
              onChange={(value) => set('warning_threshold', normalizePercentInput(value))} />
          </label>
          <label className="modal-field">{tr('input.critical_threshold')}
            <NumberStepper min="0" max="100" step="1" value={f.critical_threshold}
              onChange={(value) => set('critical_threshold', normalizePercentInput(value))} />
          </label>
          <label className="modal-field">{tr('input.trend_periods')}
            <NumberStepper min="2" max="12" step="1" value={f.trend_drop_periods}
              onChange={(value) => set('trend_drop_periods', normalizeTrendInput(value))} />
          </label>
        </div>
        <label className="modal-field">{tr('input.alert_muted_until')}
          <input type="date" value={f.alert_muted_until} onChange={(e) => set('alert_muted_until', e.target.value)} />
        </label>

        {w !== kpi.weight || targetObjId !== (kpi.objective_id ?? null) ? (
          <WeightHint total={displayTotal} label={tr('wh.kpi_group', { name: groupName })} tr={tr} />
        ) : null}
        {!thresholdsValid && <div className="weight-hint red">{tr('input.threshold_invalid')}</div>}
        {currentChanged && (
          <div className="weight-hint yellow">
            {tr('kpim.manual_warning', { old: kpi.current_value, new: cv, unit: f.unit })}
          </div>
        )}

        <label className="modal-field">{tr('kpim.reason')} <b>{tr('kpim.reason_required')}</b>
          <input placeholder={tr('kpim.reason_ph')}
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>

        {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>{tr('kpim.cancel')}</button>
          <button
            className="btn primary"
            disabled={saving || !changed || !f.name.trim() || !wValid || !tvValid || !cvValid || !thresholdsValid || !trendValid || over || !reason.trim()}
            onClick={save}
          >
            {saving ? tr('kpim.saving') : tr('kpim.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function SmartPanel({ result, tr }) {
  const scoreClass = (v) => v === 2 ? 'smart-ok' : v === 1 ? 'smart-partial' : 'smart-fail'
  const scoreIcon = (v) => v === 2 ? <UiIcon name="check" /> : v === 1 ? '~' : <UiIcon name="x" />
  return (
    <div className="smart-panel">
      <div className="smart-scores">
        {['S', 'M', 'A', 'R', 'T'].map((k) => (
          <span key={k} className={`smart-score ${scoreClass(result.scores?.[k] ?? 0)}`}
            title={tr(`kpis.smart_criterion_${k}`)}>
            <b>{k}</b> {scoreIcon(result.scores?.[k] ?? 0)}
          </span>
        ))}
        <span className={`smart-verdict ${result.valid ? 'smart-ok' : 'smart-fail'}`}>
          <UiIcon name={result.valid ? 'check' : 'warning'} />{cleanIconLabel(result.valid ? tr('kpis.smart_pass') : tr('kpis.smart_fail'))}
        </span>
      </div>
      {result.issues?.length > 0 && (
        <div className="smart-section">
          <b className="icon-heading"><UiIcon name="warning" /> {tr('kpis.smart_issues')}</b>
          <ul>{result.issues.map((iss, i) => <li key={i}>{iss}</li>)}</ul>
        </div>
      )}
      {result.suggestions?.length > 0 && (
        <div className="smart-section">
          <b className="icon-heading"><UiIcon name="sparkles" /> {tr('kpis.smart_suggestions')}</b>
          <ul>{result.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

function PeriodMetricsPanel({ kpi, locked, tr, initialPeriodKey = '' }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    period_type: kpi.cadence || 'monthly',
    period_key: currentPeriodKey(kpi.cadence || 'monthly'),
    target_value: String(kpi.target_value || 100),
    actual_value: '0',
    confirmed: true,
  })

  useEffect(() => {
    if (!initialPeriodKey) return
    setForm((prev) => ({ ...prev, period_key: initialPeriodKey }))
  }, [initialPeriodKey])

  const load = () => {
    setLoading(true)
    api.kpiPeriodMetrics(kpi.id)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [kpi.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))
  const target = num(form.target_value)
  const actual = num(form.actual_value)
  const valid = form.period_key.trim() && !isNaN(target) && target > 0 && !isNaN(actual) && actual >= 0

  const save = async () => {
    if (!valid) return
    setSaving(true)
    setError('')
    try {
      await api.upsertKpiPeriodMetric(kpi.id, {
        period_key: form.period_key.trim(),
        period_type: form.period_type,
        target_value: target,
        actual_value: actual,
        confirmed: form.confirmed,
      })
      setForm((prev) => ({ ...prev, actual_value: '0' }))
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const pickRow = (row) => {
    setForm({
      period_type: row.period_type,
      period_key: row.period_key,
      target_value: String(row.target_value),
      actual_value: String(row.actual_value),
      confirmed: row.confirmed !== false,
    })
  }

  return (
    <div className="period-metrics-panel">
      <div className="period-metrics-head">
        <strong><UiIcon name="table" />{tr('input.period_metrics')}</strong>
        <span>{tr('input.period_metrics_hint')}</span>
      </div>
      <div className="period-metric-form">
        <label>{tr('input.period_type')}
          <select value={form.period_type} onChange={(e) => {
            const next = e.target.value
            setForm((prev) => ({ ...prev, period_type: next, period_key: currentPeriodKey(next) }))
          }}>
            {CADENCES.map((opt) => <option key={opt} value={opt}>{tr(`input.cadence_${opt}`)}</option>)}
          </select>
        </label>
        <label>{tr('input.period_key')}
          <input value={form.period_key} onChange={(e) => set('period_key', e.target.value)} />
        </label>
        <label>{tr('input.period_target')}
          <NumberStepper min="0" step="any" className="inline" value={form.target_value}
            onChange={(value) => set('target_value', normalizeNonNegativeInput(value))} />
        </label>
        <label>{tr('input.period_actual')}
          <NumberStepper min="0" step="any" className="inline" value={form.actual_value}
            onChange={(value) => set('actual_value', normalizeNonNegativeInput(value))} />
        </label>
        <button className="btn primary small" type="button" disabled={locked || saving || !valid} onClick={save}>
          {saving ? tr('common.loading') : tr('input.save_period')}
        </button>
      </div>
      {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
      {loading ? (
        <div className="muted">{tr('common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="muted">{tr('input.period_empty')}</div>
      ) : (
        <table className="table period-metrics-table">
          <thead>
            <tr>
              <th>{tr('input.period_key')}</th>
              <th>{tr('input.period_target')}</th>
              <th>{tr('input.period_actual')}</th>
              <th>{tr('input.attainment')}</th>
              <th>{tr('journal.col_source')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={() => pickRow(row)}>
                <td className="nowrap">{row.period_key}</td>
                <td>{Number(row.target_value).toLocaleString()}</td>
                <td>{Number(row.actual_value).toLocaleString()}</td>
                <td>{row.attainment_pct}%</td>
                <td>{tr(`input.metric_source_${row.source_type || 'manual'}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function KpiCockpit({ objectives, visibleKpis, conflicts, totalObjWeight, locked, importLoading = false, onShowConflicts, onAddKpi, onImport, tr }) {
  const weightedProgress = objectives.length
    ? Math.round(objectives.reduce((s, o) => s + ((o.progress || 0) * (o.weight || 0) / 100), 0) * 10) / 10
    : Math.round((visibleKpis.reduce((s, k) => s + (k.progress || 0), 0) / Math.max(visibleKpis.length, 1)) * 10) / 10
  const riskKpis = visibleKpis.filter((k) => (k.progress || 0) < 50)
  const overKpis = visibleKpis.filter((k) => (k.progress || 0) > 100)
  const weightGap = Math.round((100 - totalObjWeight) * 10) / 10
  const bestNext = conflicts.length
    ? tr('kpis.cockpit_best_conflicts', { count: conflicts.length })
    : totalObjWeight !== 100
      ? tr('kpis.cockpit_best_weight', {
        direction: weightGap > 0 ? tr('kpis.cockpit_weight_left') : tr('kpis.cockpit_weight_over'),
        pct: Math.abs(weightGap),
      })
      : riskKpis.length
        ? tr('kpis.cockpit_best_risk', { count: riskKpis.length })
        : tr('kpis.cockpit_best_good')

  return (
    <section className="kpi-cockpit" aria-label={tr('kpis.cockpit_aria')}>
      <div className="cockpit-hero">
        <span className="cockpit-kicker">{tr('kpis.cockpit_kicker')}</span>
        <h2>{weightedProgress}%</h2>
        <p>{tr('kpis.cockpit_weighted_progress')}</p>
        <div className="cockpit-orbit" aria-hidden="true">
          <span style={{ '--v': `${Math.min(100, weightedProgress)}%` }} />
        </div>
      </div>
      <div className="cockpit-grid">
        <div className="cockpit-metric">
          <span>{tr('kpis.cockpit_total_kpis')}</span>
          <b>{visibleKpis.length}</b>
          <small>{tr('kpis.cockpit_objective_count', { count: objectives.length })}</small>
        </div>
        <button className={`cockpit-metric clickable ${conflicts.length ? 'danger' : 'ok'}`} onClick={onShowConflicts}>
          <span>{tr('kpis.cockpit_conflicts')}</span>
          <b>{conflicts.length}</b>
          <small>{conflicts.length ? tr('kpis.cockpit_conflicts_needs_action') : tr('kpis.cockpit_conflicts_ok')}</small>
        </button>
        <div className={`cockpit-metric ${totalObjWeight === 100 ? 'ok' : totalObjWeight > 100 ? 'danger' : 'warn'}`}>
          <span>{tr('kpis.cockpit_objective_weight')}</span>
          <b>{totalObjWeight}%</b>
          <small>{totalObjWeight === 100 ? tr('kpis.cockpit_weight_ok') : tr('kpis.cockpit_weight_gap', {
            pct: Math.abs(weightGap),
            direction: weightGap > 0 ? tr('kpis.cockpit_weight_left') : tr('kpis.cockpit_weight_over'),
          })}</small>
        </div>
        <div className="cockpit-metric">
          <span>{tr('kpis.cockpit_over_target')}</span>
          <b>{overKpis.length}</b>
          <small>{tr('kpis.cockpit_bright_spots')}</small>
        </div>
      </div>
      <div className="cockpit-next">
        <div className="cockpit-next-copy">
          <span className="cockpit-kicker">{tr('kpis.cockpit_next_suggestion')}</span>
          <strong>{bestNext}</strong>
        </div>
        <div className="cockpit-next-actions">
          <button
            className={`btn import-cta ${importLoading ? 'is-loading' : ''}`}
            disabled={locked || importLoading}
            onClick={onImport}
            aria-busy={importLoading}
            title={importLoading ? tr('kpis.import_preparing') : cleanIconLabel(tr('kpis.btn_import'))}
          >
            <UiIcon name={importLoading ? 'refresh' : 'upload'} />
            <span>{importLoading ? tr('kpis.import_btn_loading') : cleanIconLabel(tr('kpis.btn_import'))}</span>
          </button>
          <button className="btn primary" disabled={locked} onClick={onAddKpi}>
            <UiIcon name="plus" />
            <span>{cleanIconLabel(tr('kpis.btn_add'))}</span>
          </button>
        </div>
        {importLoading && (
          <div className="cockpit-import-status" role="status" aria-live="polite">
            <span className="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
            <span>{tr('kpis.import_preparing')}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function ImportFocusLoading({ tr }) {
  return (
    <div className="modal-overlay import-focus-loading" role="alertdialog" aria-modal="true" aria-labelledby="import-focus-title">
      <div className="modal import-focus-card" onClick={(e) => e.stopPropagation()}>
        <div className="import-focus-icon" aria-hidden="true">
          <UiIcon name="refresh" />
        </div>
        <h3 id="import-focus-title">{tr('kpis.import_focus_title')}</h3>
        <p>{tr('kpis.import_preparing')}</p>
        <div className="typing-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <small>{tr('kpis.import_focus_hint')}</small>
      </div>
    </div>
  )
}

function ExportFocusLoading({ tr }) {
  return (
    <div className="modal-overlay import-focus-loading" role="alertdialog" aria-modal="true" aria-labelledby="export-focus-title">
      <div className="modal import-focus-card" onClick={(e) => e.stopPropagation()}>
        <div className="import-focus-icon" aria-hidden="true">
          <UiIcon name="refresh" />
        </div>
        <h3 id="export-focus-title">{tr('kpis.export_focus_title')}</h3>
        <p>{tr('kpis.export_focus_message')}</p>
        <div className="typing-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <small>{tr('kpis.export_focus_hint')}</small>
      </div>
    </div>
  )
}

function KpiCard({ kpi, busyId, expanded, metricsOpen, metricsPeriodKey, changelog, smartResult, smartLoadingId, actions, inConflict, locked, tr }) {
  // dich ten truong/gia tri trong lich su thay doi sang tieng nguoi dung (khong lo ten field tho)
  const fieldLabel = (f) => { const k = `field.${f}`; const t = tr(k); return t === k ? f : t }
  const fieldValue = (f, v) => {
    if (f === 'archived') return tr(`fieldval.archived.${String(v).toLowerCase() === 'true'}`)
    return v
  }
  const over = kpi.progress > 100
  const statusClass = over ? 'over' : kpi.progress >= 70 ? 'good' : kpi.progress >= 40 ? 'watch' : 'risk'
  const statusLabel = over
    ? tr('kpis.status_over')
    : kpi.progress >= 70
      ? tr('kpis.status_good')
      : kpi.progress >= 40
        ? tr('kpis.status_watch')
        : tr('kpis.status_risk')
  const measure = kpi.unit === '%'
    ? <>{tr('kpis.actual')} <b>{kpi.current_value}%</b></>
    : <>{tr('kpis.actual')} <b>{kpi.current_value}/{kpi.target_value} {kpi.unit}</b> ({kpi.progress}%)</>
  return (
    <div id={`kpi-${kpi.id}`} className={`card kpi-row status-${statusClass}${inConflict ? ' in-conflict' : ''}`}>
      <div className="kpi-card-grid">
        <div className="kpi-main">
          <div className="kpi-title-line">
            <strong>{kpi.name}</strong>
            <span className={`cat-badge ${kpi.category === 'Personal' ? 'personal' : 'work'}`}>
              <UiIcon name={kpi.category === 'Personal' ? 'user' : 'fileText'} />
              {cleanIconLabel(kpi.category === 'Personal' ? tr('category.personal') : tr('category.work'))}
            </span>
            {over && <span className="over-badge">{tr('kpis.over_badge')}</span>}
            {inConflict && <span className="conflict-tag">{tr('kpis.conflict_tag')}</span>}
          </div>
          <div className="kpi-meta">
            {kpi.target && <span className="meta-seg">{kpi.target}</span>}
            <span className="meta-seg">{measure}</span>
            <span className="meta-seg">{tr('kpis.meta_weight', { weight: kpi.weight })}</span>
            <span className="meta-seg">{tr(`input.cadence_${kpi.cadence || 'monthly'}`)}</span>
            <span className="meta-seg">{tr(`input.source_${kpi.data_source_mode || 'manual'}`)}</span>
            <span className="meta-seg">{kpi.deadline || `${kpi.year}-12-31`}</span>
          </div>
          <div className="progress-track mini">
            <div className="progress-fill gradient" style={{ width: `${Math.min(100, kpi.progress)}%` }} />
          </div>
          <div className="kpi-progress-caption">
            <span>{kpi.progress}%</span>
            <span>{statusLabel}</span>
          </div>
        </div>
        <div className="kpi-actions">
          <button
            className={`icon-btn ${busyId === kpi.id ? 'spinning' : ''}`}
            disabled={locked || busyId === kpi.id}
            title={locked ? tr('cycle.locked_tip') : busyId === kpi.id ? tr('kpis.agent_decomposing') : tr('kpis.tip_decompose')}
            onClick={() => actions.decompose(kpi.id)}
          ><UiIcon name="sparkles" /></button>
          {kpi.sub_goals?.length > 0 && (
            <button className={`icon-btn ${expanded === kpi.id ? 'on' : ''}`}
              title={tr('kpis.view_subgoals', { count: kpi.sub_goals.length })}
              onClick={() => actions.toggleExpand(kpi.id)}><UiIcon name="list" /></button>
          )}
          <button className={`icon-btn ${metricsOpen === kpi.id ? 'on' : ''}`} title={tr('input.period_metrics')} onClick={() => actions.toggleMetrics(kpi.id)}><UiIcon name="table" /></button>
          <button className="icon-btn" disabled={locked} title={locked ? tr('cycle.locked_tip') : tr('kpis.tip_edit')} onClick={() => actions.edit(kpi)}><UiIcon name="edit" /></button>
          <button className={`icon-btn ${changelog[kpi.id] ? 'on' : ''}`} title={tr('kpis.changelog_title')} onClick={() => actions.toggleLog(kpi.id)}><UiIcon name="clock" /></button>
          <button
            className={`icon-btn ${smartResult ? 'on' : ''} ${smartLoadingId === kpi.id ? 'spinning' : ''}`}
            disabled={smartLoadingId === kpi.id}
            title={smartLoadingId === kpi.id ? tr('kpis.smart_loading') : tr('kpis.tip_smart')}
            onClick={() => actions.smartCheck(kpi.id)}
          ><UiIcon name="target" /></button>
          <button className="icon-btn danger" disabled={locked} title={locked ? tr('cycle.locked_tip') : tr('kpis.tip_archive')} onClick={() => actions.archive(kpi)}><UiIcon name="trash" /></button>
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

      {metricsOpen === kpi.id && <PeriodMetricsPanel kpi={kpi} locked={locked} tr={tr} initialPeriodKey={metricsPeriodKey} />}

      {smartResult && <SmartPanel result={smartResult} tr={tr} />}

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
                    <td className="nowrap">{l.changed_at?.slice(0, 19).replace('T', ' ')}</td><td>{fieldLabel(l.field)}</td>
                    <td>{fieldValue(l.field, l.old_value)}</td><td>{fieldValue(l.field, l.new_value)}</td><td>{l.reason}</td>
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

/* ===== Import Wizard — 3 bước: Preview → Gán trọng số → Xác nhận & Lưu ===== */
function ImportWizard({
  preview,
  objectives,
  kpis,
  cycleId,
  onClose,
  onSaved,
  tr,
  aiReply = '',
  forceAssignStep = false,
  weightChanges = [],
  onOpenChat = null,
  chatOpening = false,
}) {
  const [step, setStep] = useState('preview') // 'preview' | 'assign' | 'confirm'
  const [weights, setWeights] = useState({})
  const [initialWeights, setInitialWeights] = useState({}) // để track thay đổi
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [removedObjectives, setRemovedObjectives] = useState({})
  const [removedKpis, setRemovedKpis] = useState({})

  const objKey = (name) => `obj::${name}`
  const kpiKey = (oName, kName) => `kpi::${oName}::${kName}`
  const isObjectiveRemoved = (o) => !!removedObjectives[objKey(o.name)]
  const isKpiRemoved = (o, k) => isObjectiveRemoved(o) || !!removedKpis[kpiKey(o.name, k.name)]
  const activeObjectives = preview.objectives
    .filter((o) => !isObjectiveRemoved(o))
    .map((o) => ({ ...o, kpis: (o.kpis || []).filter((k) => !isKpiRemoved(o, k)) }))
    .filter((o) => o.kpis.length > 0)
  const activeImportKpis = activeObjectives.reduce((s, o) => s + o.kpis.length, 0)
  const hasRemovedItems = Object.values(removedObjectives).some(Boolean) || Object.values(removedKpis).some(Boolean)
  const removeObjectiveFromImport = (o) => {
    setError('')
    setRemovedObjectives((items) => ({ ...items, [objKey(o.name)]: true }))
  }
  const removeKpiFromImport = (o, k) => {
    setError('')
    setRemovedKpis((items) => ({ ...items, [kpiKey(o.name, k.name)]: true }))
  }

  const errors = preview.messages.filter((m) => m.level === 'error')
  const hasHardErrors = errors.length > 0
  const importedObjWeight = Math.round(activeObjectives
    .filter((o) => o.is_new)
    .reduce((s, o) => s + (o.weight || 0), 0) * 10) / 10
  const existingByCategory = preview.existing_obj_totals_by_category || { Work: preview.existing_obj_total || 0, Personal: 0 }
  const projectedObjWeightByCategory = ['Work', 'Personal'].reduce((acc, cat) => {
    const added = activeObjectives
      .filter((o) => o.is_new && (o.category || 'Work') === cat)
      .reduce((s, o) => s + (o.weight || 0), 0)
    acc[cat] = Math.round(((existingByCategory[cat] || 0) + added) * 10) / 10
    return acc
  }, {})
  const projectedObjWeight = Math.max(projectedObjWeightByCategory.Work || 0, projectedObjWeightByCategory.Personal || 0)
  const totalImportKpis = activeImportKpis

  // Kiểm tra có thay đổi so với ban đầu không
  const hasChanges = Object.keys(weights).some((key) => weights[key] !== initialWeights[key]) || hasRemovedItems

  // Xử lý đóng — có xác nhận nếu có thay đổi
  const handleClose = () => {
    if (saving) return
    if (hasChanges) {
      setShowCloseConfirm(true)
    } else {
      onClose()
    }
  }

  // Pre-populate tat ca weight fields khi chuyen sang buoc 2
  const enterAssignStep = () => {
    const initial = {}
    activeObjectives.forEach((o) => {
      if (o.is_new) initial[objKey(o.name)] = o.weight > 0 ? String(o.weight) : ''
      o.kpis.forEach((k) => { initial[kpiKey(o.name, k.name)] = k.has_weight ? String(k.weight) : '' })
    })
    setWeights(initial)
    setInitialWeights(initial) // lưu lại giá trị ban đầu để so sánh
    setStep('assign')
  }

  // Xay dung KPIProposalConfirm payload tu preview data + user weights
  const buildProposal = () => {
    const readWeight = (key, fallback = 0) => {
      const value = parseFloat(weights[key])
      return Number.isFinite(value) ? value : fallback
    }
    const newObjectives = activeObjectives
      .filter((o) => o.is_new)
      .map((o) => ({
        name: o.name,
        description: '',
        weight: readWeight(objKey(o.name), o.weight || 0),
        category: o.category || 'Work',
      }))
    const allKpis = activeObjectives.flatMap((o) =>
      o.kpis.map((k) => ({
        name: k.name,
        description: k.description || k.note || '',
        target: k.target || '',
        unit: k.unit || '%',
        target_value: Number.isFinite(Number(k.target_value)) ? Number(k.target_value) : 100.0,
        weight: readWeight(kpiKey(o.name, k.name), k.weight || 0),
        deadline: k.deadline || null,
        objective_id: o.is_new ? null : o.objective_id,
        objective_ref: o.is_new ? o.name : null,
        category: k.category || o.category || 'Work',
      }))
    )
    return { objectives: newObjectives, kpis: allKpis, weight_changes: weightChanges || [], cycle_id: cycleId ?? null, source_mode: 'export' }
  }

  const handleSave = async () => {
    if (saving) return
    const proposal = buildProposal()
    if (proposal.kpis.length === 0) {
      setError(tr('import.wizard.empty_after_remove'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const created = await api.confirmKpiProposal(proposal)
      onSaved(created)
    } catch (e) {
      setError(e.message || String(e))
      setSaving(false)
    }
  }

  const closeConfirmModal = showCloseConfirm ? (
    <div className="modal-overlay import-close-confirm">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{tr('import.wizard.close_confirm_title')}</h3>
        <p className="muted">{tr('import.wizard.close_confirm_msg')}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => setShowCloseConfirm(false)}>
            {tr('import.wizard.close_confirm_no')}
          </button>
          <button className="btn danger" onClick={() => { setShowCloseConfirm(false); onClose() }}>
            {tr('import.wizard.close_confirm_yes')}
          </button>
        </div>
      </div>
    </div>
  ) : null

  if (step === 'assign') {
    // Client-side real-time validation
    const getW = (key, def) => { const v = parseFloat(weights[key]); return isNaN(v) ? def : v }

    const effectiveObjTotalsByCategory = ['Work', 'Personal'].reduce((acc, cat) => {
      const effectiveNewObjTotal = activeObjectives
        .filter((o) => o.is_new && (o.category || 'Work') === cat)
        .reduce((s, o) => s + getW(objKey(o.name), o.weight || 0), 0)
      acc[cat] = (existingByCategory[cat] || 0) + effectiveNewObjTotal
      return acc
    }, {})
    const effectiveObjTotal = Math.max(
      effectiveObjTotalsByCategory.Work || 0,
      effectiveObjTotalsByCategory.Personal || 0,
    )

    const getKpiTotal = (o) =>
      o.existing_kpi_total + o.kpis.reduce((s, k) => s + getW(kpiKey(o.name, k.name), k.weight || 0), 0)

    const clientErrors = []
    Object.entries(effectiveObjTotalsByCategory).forEach(([cat, total]) => {
      if (total > 100.001) {
        const label = cat === 'Personal' ? cleanIconLabel(tr('category.personal')) : cleanIconLabel(tr('category.work'))
        clientErrors.push(`${label}: ${tr('import.wizard.err_obj_total_over', { pct: total.toFixed(1) })}`)
      }
    })
    activeObjectives.forEach((o) => {
      const t = getKpiTotal(o)
      if (t > 100.001)
        clientErrors.push(tr('import.wizard.err_kpi_total_over', { name: o.name, pct: t.toFixed(1) }))
    })
    const canSaveNow = clientErrors.length === 0 && activeImportKpis > 0

    const newObjs = activeObjectives.filter((o) => o.is_new)

    return (
      <div className="modal-overlay">
        <div className="modal modal-wide import-wizard" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={handleClose} disabled={saving} title={tr('kpim.cancel')}><UiIcon name="x" /></button>
          <div className="wizard-steps">
            <span className="step done">{tr('import.wizard.step_preview')}</span>
            <span className="step active">{tr('import.wizard.step_assign')}</span>
            <span className="step">{tr('import.wizard.step_confirm')}</span>
          </div>
          <h3 className="icon-heading"><UiIcon name="fileSpreadsheet" /> {tr('import.wizard.assign_title')}</h3>

          <div className={`assign-summary ${effectiveObjTotal > 100.001 ? 'danger' : 'ok'}`}>
            <div>
              <span>{tr('import.wizard.existing_objectives')}</span>
              <b>{Math.max(existingByCategory.Work || 0, existingByCategory.Personal || 0)}%</b>
            </div>
            <div>
              <span>{tr('import.wizard.after_adjustment')}</span>
              <b>{Math.round(effectiveObjTotal * 10) / 10}%</b>
            </div>
            <div>
              <span>{tr('import.wizard.remaining_allocation')}</span>
              <b>{Math.max(0, Math.round((100 - Math.max(existingByCategory.Work || 0, existingByCategory.Personal || 0)) * 10) / 10)}%</b>
            </div>
          </div>

          {/* Loi client-side real-time */}
          {clientErrors.length > 0 && (
            <div className="import-messages">
              {clientErrors.map((msg, i) => (
                <div key={i} className="msg-line msg-error">{tr('import.wizard.msg_error_prefix')} {msg}</div>
              ))}
            </div>
          )}
          {activeImportKpis === 0 && (
            <div className="msg-line msg-warning">{tr('import.wizard.msg_warning_prefix')} {tr('import.wizard.empty_after_remove')}</div>
          )}
          <p className="muted import-remove-note">{tr('import.wizard.remove_note')}</p>

          {/* Phan A: trong so muc tieu moi */}
          {newObjs.length > 0 && (
            <div className={`assign-section${effectiveObjTotal > 100.001 ? ' has-error' : ''}`}>
              <h4>{tr('import.wizard.new_obj_section')}</h4>
              {newObjs.map((o) => (
                <div key={o.name} className="weight-input-row has-action">
                  <span className="weight-label">{o.name}</span>
                  <NumberStepper
                    min="0" max="100" step="1" className="compact"
                    value={weights[objKey(o.name)] ?? ''}
                    onChange={(value) => setWeights((w) => ({ ...w, [objKey(o.name)]: normalizeWeightInput(value) }))}
                  />
                  <span>%</span>
                  <button
                    className="icon-btn danger import-row-remove"
                    title={tr('import.wizard.remove_obj')}
                    aria-label={tr('import.wizard.remove_obj')}
                    onClick={() => removeObjectiveFromImport(o)}
                  >
                    <UiIcon name="trash" />
                  </button>
                </div>
              ))}
              <button className="btn small ghost" onClick={() => {
                const upd = {}
                ;['Work', 'Personal'].forEach((cat) => {
                  const catObjs = newObjs.filter((o) => (o.category || 'Work') === cat)
                  const remaining = Math.max(0, 100 - (existingByCategory[cat] || 0))
                  const each = catObjs.length > 0 ? Math.floor(remaining / catObjs.length) : 0
                  catObjs.forEach((o) => { upd[objKey(o.name)] = String(each) })
                })
                setWeights((w) => ({ ...w, ...upd }))
              }}>{tr('import.wizard.even_split')}</button>
              <WeightHint total={effectiveObjTotal} label={tr('wh.obj_total')} tr={tr} />
            </div>
          )}

          {/* Phan B: tat ca KPI cua tung muc tieu (ke ca co san trong so) */}
          {activeObjectives.map((o) => {
            if (o.kpis.length === 0) return null
            const kpiTotal = getKpiTotal(o)
            const hasKpiError = kpiTotal > 100.001
            return (
              <div key={o.name} className={`assign-section${hasKpiError ? ' has-error' : ''}`}>
                <div className="assign-section-header">
                  <h4>{tr('import.wizard.kpi_section', { name: o.name })}</h4>
                  <button className="btn small ghost danger" onClick={() => removeObjectiveFromImport(o)}>
                    <UiIcon name="trash" />
                    {tr('import.wizard.remove_obj_short')}
                  </button>
                </div>
                {o.existing_kpi_total > 0 && (
                  <p className="muted">{tr('import.wizard.obj_existing_total', { pct: o.existing_kpi_total.toFixed(0) })}</p>
                )}
                {o.kpis.map((k) => (
                  <div key={k.name} className="weight-input-row has-action">
                    <span className="weight-label">{k.name}</span>
                    <NumberStepper
                      min="0" max="100" step="1" className="compact"
                      value={weights[kpiKey(o.name, k.name)] ?? ''}
                      onChange={(value) => setWeights((w) => ({ ...w, [kpiKey(o.name, k.name)]: normalizeWeightInput(value) }))}
                    />
                    <span>%</span>
                    <button
                      className="icon-btn danger import-row-remove"
                      title={tr('import.wizard.remove_kpi')}
                      aria-label={tr('import.wizard.remove_kpi')}
                      onClick={() => removeKpiFromImport(o, k)}
                    >
                      <UiIcon name="trash" />
                    </button>
                  </div>
                ))}
                <button className="btn small ghost" onClick={() => {
                  const remaining = Math.max(0, 100 - o.existing_kpi_total)
                  const each = o.kpis.length > 0 ? Math.floor(remaining / o.kpis.length) : 0
                  const upd = {}
                  o.kpis.forEach((k) => { upd[kpiKey(o.name, k.name)] = String(each) })
                  setWeights((w) => ({ ...w, ...upd }))
                }}>{tr('import.wizard.even_split')}</button>
                <WeightHint total={kpiTotal} label={tr('wh.obj_total')} tr={tr} />
              </div>
            )
          })}

          {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setStep('preview')}>{tr('import.wizard.back')}</button>
            <button className="btn primary" disabled={!canSaveNow} onClick={() => setStep('confirm')}>
              {tr('import.wizard.review_btn')}
            </button>
          </div>
        </div>
        {closeConfirmModal}
      </div>
    )
  }

  // Step 3: Confirm — tong ket truoc khi luu
  if (step === 'confirm') {
    const getW = (key, def) => { const v = parseFloat(weights[key]); return isNaN(v) ? def : v }
    const newObjs = activeObjectives.filter((o) => o.is_new)
    const effectiveObjTotalsByCategory = ['Work', 'Personal'].reduce((acc, cat) => {
      const added = newObjs
        .filter((o) => (o.category || 'Work') === cat)
        .reduce((s, o) => s + getW(objKey(o.name), o.weight || 0), 0)
      acc[cat] = (existingByCategory[cat] || 0) + added
      return acc
    }, {})
    const effectiveObjTotal = Math.max(
      effectiveObjTotalsByCategory.Work || 0,
      effectiveObjTotalsByCategory.Personal || 0,
    )
    const totalKpis = activeImportKpis

    return (
      <div className="modal-overlay">
        <div className="modal modal-wide import-wizard" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={handleClose} disabled={saving} title={tr('kpim.cancel')}><UiIcon name="x" /></button>
          <div className="wizard-steps">
            <span className="step done">{tr('import.wizard.step_preview')}</span>
            <span className="step done">{tr('import.wizard.step_assign')}</span>
            <span className="step active">{tr('import.wizard.step_confirm')}</span>
          </div>
          <h3 className="icon-heading"><UiIcon name="checkCircle" /> {tr('import.wizard.confirm_title')}</h3>

          <div className="assign-section">
            <p>{tr('import.wizard.confirm_summary', { objs: newObjs.length, kpis: totalKpis })}</p>
            <WeightHint total={effectiveObjTotal} label={tr('wh.obj_total')} tr={tr} />
          </div>

          {newObjs.length > 0 && (
            <div className="assign-section">
              <h4>{tr('import.wizard.new_obj_section')}</h4>
              {newObjs.map((o) => {
                const w = getW(objKey(o.name), o.weight || 0)
                const kpiCount = o.kpis.length
                const kpiTotal = o.existing_kpi_total + o.kpis.reduce(
                  (s, k) => s + getW(kpiKey(o.name, k.name), k.weight || 0), 0
                )
                return (
                  <div key={o.name} className="weight-input-row">
                    <span className="weight-label">{o.name}</span>
                    <span className="muted">{w}% — {kpiCount} KPI ({kpiTotal.toFixed(0)}%)</span>
                  </div>
                )
              })}
            </div>
          )}

          {activeObjectives.filter((o) => !o.is_new && o.kpis.length > 0).map((o) => (
            <div key={o.name} className="assign-section">
              <div className="weight-input-row">
                <span className="weight-label">{o.name}</span>
                <span className="muted">{tr('import.wizard.tag_existing')} — {o.kpis.length} KPI</span>
              </div>
            </div>
          ))}

          {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
          <div className="modal-actions">
            <button className="btn ghost" disabled={saving} onClick={() => setStep('assign')}>{tr('import.wizard.back')}</button>
            <button className="btn primary" disabled={saving || totalKpis === 0} onClick={handleSave}>
              {saving ? tr('import.wizard.saving') : cleanIconLabel(tr('import.wizard.save_btn'))}
            </button>
          </div>
        </div>
        {closeConfirmModal}
      </div>
    )
  }

  // Step 1: Preview
  return (
    <div className="modal-overlay">
      <div className="modal modal-wide import-wizard" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={handleClose} disabled={saving} title={tr('kpim.cancel')}><UiIcon name="x" /></button>
        <div className="wizard-steps">
          <span className="step active">{tr('import.wizard.step_preview')}</span>
          <span className="step">{tr('import.wizard.step_assign')}</span>
          <span className="step">{tr('import.wizard.step_confirm')}</span>
        </div>
        <h3 className="icon-heading"><UiIcon name="archive" /> {tr('import.wizard.preview_title')}</h3>
        {aiReply && <ImportAiReplyBlock reply={aiReply} tr={tr} />}

        <div className={`import-decision-card ${hasHardErrors ? 'danger' : preview.needs_weight_input ? 'warn' : 'ok'}`}>
          <div>
            <span>{tr('import.wizard.current')}</span>
            <b>{preview.existing_obj_total}%</b>
          </div>
          <div>
            <span>{tr('import.wizard.file_adds')}</span>
            <b>{importedObjWeight}%</b>
          </div>
          <div>
            <span>{tr('import.wizard.after_import')}</span>
            <b>{projectedObjWeight}%</b>
          </div>
          <strong>
            {hasHardErrors
              ? tr('import.wizard.need_reassign_weights')
              : preview.needs_weight_input
                ? tr('import.wizard.need_missing_weights')
                : tr('import.wizard.ready_to_save')}
          </strong>
        </div>

        {activeImportKpis === 0 && (
          <div className="msg-line msg-warning">{tr('import.wizard.msg_warning_prefix')} {tr('import.wizard.empty_after_remove')}</div>
        )}

        <details className="import-details">
          <summary>{tr('import.wizard.preview_details', { objectives: activeObjectives.length, kpis: totalImportKpis })}</summary>
        <div className="import-obj-list">
          {activeObjectives.map((o) => (
            <div key={o.name} className="import-obj-item">
              <div className="import-obj-header">
                <strong>{o.name}</strong>
                {o.weight > 0 && <span className="muted"> ({o.weight}%)</span>}
                <span className={`import-tag ${o.is_new ? 'tag-new' : 'tag-existing'}`}>
                  {o.is_new ? tr('import.wizard.tag_new_obj') : tr('import.wizard.tag_existing')}
                </span>
              </div>
              <ul className="import-kpi-list">
                {o.kpis.map((k) => (
                  <li key={k.name}>
                    {k.name}
                    {k.has_weight
                      ? <span className="muted"> ({k.weight}%)</span>
                      : <span className="import-tag tag-no-weight">{tr('import.wizard.tag_no_weight')}</span>
                    }
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        </details>

        <div className="modal-actions">
          {aiReply && onOpenChat && (
            <button className="btn" disabled={saving || chatOpening} onClick={onOpenChat}>
              <UiIcon name="message" />{tr('kpis.import_ai_open_chat')}
            </button>
          )}
          <button className="btn ghost" disabled={saving} onClick={handleClose}>{tr('kpim.cancel')}</button>
          {/* Neu co loi cung hoac can nhap trong so → cho phep sang buoc 2 de sua truc tiep */}
          {(hasHardErrors || preview.needs_weight_input || forceAssignStep) && (
            <button className="btn primary" disabled={saving || activeImportKpis === 0} onClick={enterAssignStep}>
              {hasHardErrors
                ? tr('import.wizard.fix_weights_btn')
                : tr('import.wizard.assign_weights_btn')}
            </button>
          )}
          {/* Khong co loi, khong can nhap → luu thang */}
          {preview.can_save && !preview.needs_weight_input && !forceAssignStep && (
            <button className="btn primary" disabled={saving || activeImportKpis === 0} onClick={handleSave}>
              {saving ? tr('import.wizard.saving') : cleanIconLabel(tr('import.wizard.save_btn'))}
            </button>
          )}
        </div>
        {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
      </div>

      <ConfirmModal
        open={showCloseConfirm}
        title={tr('import.wizard.close_confirm_title')}
        message={tr('import.wizard.close_confirm_msg')}
        confirmLabel={tr('import.wizard.close_confirm_yes')}
        cancelLabel={tr('import.wizard.close_confirm_no')}
        confirmVariant="danger"
        onConfirm={() => { setShowCloseConfirm(false); onClose() }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  )
}

function formatImportAiReply(text = '', fallback = '') {
  const raw = String(text || '').trim()
  if (!raw) return [fallback].filter(Boolean)
  const cleaned = raw
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/[?？]\s*$/.test(line))
    .filter((line) => !/(bạn có muốn|ban co muon|muốn tôi|muon toi|vui lòng cung cấp thêm|do you want|would you like|shall i)/i.test(line))

  const source = lines.length > 1
    ? lines
    : (cleaned.match(/[^.!?。！？]+[.!?。！？]?/g) || [cleaned])

  const complete = source
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/[?？]\s*$/.test(line))
    .filter((line) => !/(bạn có muốn|ban co muon|muốn tôi|muon toi|vui lòng cung cấp thêm|do you want|would you like|shall i)/i.test(line))
    .slice(0, 4)
    .map((line) => /[.!?。！？]$/.test(line) ? line : `${line}.`)

  return complete.length ? complete : [fallback].filter(Boolean)
}

function ImportAiReplyBlock({ reply, tr }) {
  const lines = formatImportAiReply(reply, tr('kpis.import_ai_no_proposal'))
  return (
    <div className="import-ai-reply">
      <div className="proposal-label">{tr('kpis.import_ai_feedback')}</div>
      <ul className="import-ai-reply-list">
        {lines.map((line, idx) => {
          const match = line.match(/^([^:：]{2,18})[:：]\s*(.+)$/)
          return (
            <li key={`${idx}-${line}`}>
              {match ? (
                <>
                  <span className="import-ai-reply-label">{match[1]}</span>
                  <span>{match[2]}</span>
                </>
              ) : (
                <span>{line}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AiImportResponseModal({ suggestion, tr, onClose, onOpenChat, chatOpening = false }) {
  return (
    <div className="modal-overlay">
      <div className="modal modal-wide import-wizard" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose} title={tr('kpis.conflict_close')}><UiIcon name="x" /></button>
        <h3 className="icon-heading"><UiIcon name="bot" /> {tr('kpis.import_agent_result')}</h3>
        <ImportAiReplyBlock reply={suggestion?.reply} tr={tr} />
        <div className="modal-actions">
          <button className="btn" disabled={chatOpening} onClick={onOpenChat}><UiIcon name="message" />{tr('kpis.import_ai_open_chat')}</button>
          <button className="btn primary" onClick={onClose}>{tr('kpis.conflict_close')}</button>
        </div>
      </div>
    </div>
  )
}

let _conflictCacheSignature = null
let _conflictCacheResult = null

export default function Kpis() {
  const { tr, lang } = useLang()
  const { mode } = useView()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const { activeCycleId, activeCycle, cycles, fetchCycles, setActiveCycleId, currentYear } = useCycle()
  const [kpis, setKpis] = useState([])
  const [objectives, setObjectives] = useState([])
  const [form, setForm] = useState({ ...EMPTY, year: currentYear })
  const [activeKpiTab, setActiveKpiTab] = useState('list')
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [metricsOpen, setMetricsOpen] = useState(null)
  const [metricsPeriodKey, setMetricsPeriodKey] = useState('')
  const [changelog, setChangelog] = useState({})
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [objModal, setObjModal] = useState(null) // null | {} (tao moi) | objective
  const [conflicts, setConflicts] = useState(null) // null = chưa phân tích
  const [analyzing, setAnalyzing] = useState(false)
  const [conflictsHidden, setConflictsHidden] = useState(true) // thu gọn nội dung panel
  const [conflictsClosed, setConflictsClosed] = useState(false) // đóng hẳn panel (vẫn mở lại được)
  const [conflictWarningScore, setConflictWarningScore] = useState(0.7)
  const fileRef = useRef(null)
  const formAnchorRef = useRef(null)
  const [importFileLoading, setImportFileLoading] = useState(false)
  const [importAnalyzing, setImportAnalyzing] = useState(false)
  const [importSuggestion, setImportSuggestion] = useState(null) // full ChatResponse object
  const [importChatDraft, setImportChatDraft] = useState(null) // { message, attachments } de tao chat khi user bam sang Tro ly
  const [importChatOpening, setImportChatOpening] = useState(false)
  const [exportAppraisalLoading, setExportAppraisalLoading] = useState(false)
  const [confirmingProposal, setConfirmingProposal] = useState(false)
  const [importConflict, setImportConflict] = useState(null)
  const [pendingImportFile, setPendingImportFile] = useState(null)
  const [importWizard, setImportWizard] = useState(null) // { preview } | null
  const [removeObjConfirm, setRemoveObjConfirm] = useState(null)
  const [archivePrompt, setArchivePrompt] = useState(null)
  const [balancePending, setBalancePending] = useState(null)
  const [cycleLockPrompt, setCycleLockPrompt] = useState(null) // "lock" | "unlock" | null
  const [showNewCycleModal, setShowNewCycleModal] = useState(false)

  // D4: Clone Cycle
  const [showCloneModal, setShowCloneModal] = useState(false)
  const [cloneForm, setCloneForm] = useState({ name: '', start_date: '', end_date: '' })
  const [cloneExcludes, setCloneExcludes] = useState([]) // objective ids to exclude
  const [cloneBusy, setCloneBusy] = useState(false)
  const [cloneError, setCloneError] = useState('')
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareLinks, setShareLinks] = useState([])
  const [shareExpireDays, setShareExpireDays] = useState(7)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareCopied, setShareCopied] = useState('')

  const openCloneModal = () => {
    const nextYear = new Date().getFullYear() + (activeCycle?.start_date
      ? new Date(activeCycle.start_date).getFullYear() >= new Date().getFullYear() ? 1 : 0
      : 0)
    setCloneForm({ name: tr('onboarding.cycle.year_name', { year: nextYear }), start_date: `${nextYear}-01-01`, end_date: `${nextYear}-12-31` })
    setCloneExcludes([])
    setCloneError('')
    setShowCloneModal(true)
  }

  const ensureCycleBeforeEdit = () => {
    if (activeCycleId) return true
    setError('')
    setShowNewCycleModal(true)
    return false
  }

  const onCycleCreated = async (cycle) => {
    await fetchCycles()
    setActiveCycleId(cycle.id)
    setShowNewCycleModal(false)
    toast.success(tr('cycle.create_success', { name: cycle.name }))
  }

  const doClone = async () => {
    if (!cloneForm.name.trim() || !activeCycleId) return
    setCloneBusy(true); setCloneError('')
    try {
      await api.cloneCycle(activeCycleId, {
        name: cloneForm.name.trim(),
        start_date: cloneForm.start_date || null,
        end_date: cloneForm.end_date || null,
        exclude_objective_ids: cloneExcludes,
      })
      await fetchCycles()
      setShowCloneModal(false)
      toast.success(tr('cycle.clone_success', { name: cloneForm.name }))
    } catch (e) { setCloneError(e.message) } finally { setCloneBusy(false) }
  }

  const loadShareLinks = async () => {
    if (!activeCycleId) return
    try { setShareLinks(await api.listShareLinks(activeCycleId)) } catch (_) { /* ignore */ }
  }

  const openShareModal = () => {
    loadShareLinks()
    setShowShareModal(true)
  }

  const createShareLink = async () => {
    if (!activeCycleId) return
    setShareBusy(true)
    try {
      await api.createShareLink(activeCycleId, shareExpireDays)
      await loadShareLinks()
    } catch (e) { setError(e.message) } finally { setShareBusy(false) }
  }

  const revokeShareLink = async (token) => {
    try {
      await api.revokeShareLink(token)
      await loadShareLinks()
    } catch (e) { setError(e.message) }
  }

  const copyShareLink = (token) => {
    const url = `${window.location.origin}/shared/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(token)
      toast.success(tr('share.copy_success'))
      setTimeout(() => setShareCopied(''), 2000)
    })
  }
  const [smartResults, setSmartResults] = useState({}) // { [kpiId]: result | null }
  const [smartLoadingId, setSmartLoadingId] = useState(null)
  const [groupPage, setGroupPage] = useState({}) // { [objId]: currentPage }
  const ITEMS_PER_PAGE = 10 // số KPI trên mỗi trang
  const importBusy = importFileLoading || importAnalyzing

  // Pagination helpers
  const getGroupPage = (objId) => groupPage[objId ?? 'none'] || 1
  const setGroupPageNum = (objId, page) => setGroupPage((p) => ({ ...p, [objId ?? 'none']: page }))
  const paginate = (arr, objId) => {
    const page = getGroupPage(objId)
    const start = (page - 1) * ITEMS_PER_PAGE
    return { items: arr.slice(start, start + ITEMS_PER_PAGE), page, totalPages: Math.ceil(arr.length / ITEMS_PER_PAGE) }
  }

  const isSetupComplete = (k, o) => {
    if (k.length < 2 || o.length === 0) return false
    return ['Work', 'Personal'].some((cat) => {
      const catObjectives = o.filter((item) => (item.category || 'Work') === cat)
      const catKpis = k.filter((item) => (item.category || 'Work') === cat)
      if (catKpis.length < 2 || catObjectives.length === 0) return false
      const objWeight = Math.round(catObjectives.reduce((s, item) => s + (item.weight || 0), 0) * 10) / 10
      if (objWeight !== 100) return false
      return catObjectives.every((obj) => {
        const group = catKpis.filter((item) => item.objective_id === obj.id)
        if (group.length === 0) return false
        const total = Math.round(group.reduce((s, item) => s + (item.weight || 0), 0) * 10) / 10
        return total === 100
      })
    })
  }

  const load = () =>
    Promise.all([api.listKpis(activeCycleId), api.listObjectives(activeCycleId)])
      .then(([k, o]) => {
        setKpis(k); setObjectives(o)
        if (isSetupComplete(k, o)) {
          const conflictSignature = `${activeCycleId || 'all'}:${k.map((kpi) => [
            kpi.id, kpi.name, kpi.target, kpi.weight, kpi.target_value, kpi.current_value,
            kpi.deadline, kpi.cadence, kpi.data_source_mode,
          ].join('|')).sort().join('~')}`
          if (_conflictCacheSignature === conflictSignature && _conflictCacheResult !== null) {
            setConflicts(_conflictCacheResult)
            if (_conflictCacheResult.length) { setConflictsHidden(true); setConflictsClosed(false) }
          } else if (_conflictCacheSignature !== conflictSignature) {
            _conflictCacheSignature = conflictSignature
            analyzeConflicts(false)
          }
        } else {
          setConflicts([])
          _conflictCacheSignature = null
          _conflictCacheResult = null
        }
      })
      .catch((e) => setError(e.message))
  useEffect(() => { load() }, [activeCycleId])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.brainSettings()
      .then((s) => setConflictWarningScore(Number(s.conflict_warning_score ?? 0.7)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!kpis.length) return
    const params = new URLSearchParams(location.search)
    const focusId = Number(params.get('focus_kpi') || 0)
    const periodKey = params.get('period_key') || ''
    if (!focusId || !kpis.some(k => k.id === focusId)) return
    setMetricsOpen(focusId)
    setMetricsPeriodKey(periodKey)
    requestAnimationFrame(() => {
      document.getElementById(`kpi-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [kpis, location.search])

  const activeCategory = mode === 'personal' ? 'Personal' : 'Work'
  const activeObjectives = objectives.filter((o) => (o.category || 'Work') === activeCategory)
  const totalObjWeight = Math.round(activeObjectives.reduce((s, o) => s + (o.weight || 0), 0) * 10) / 10

  // tong trong so KPI trong nhom dich cua form tao moi
  const formObjId = form.objective_id === '' ? null : Number(form.objective_id)
  const formW = num(form.weight) || 0
  const formWeightValid = Number.isInteger(formW) && formW >= 0 && formW <= 100
  const formTargetValue = num(form.target_value)
  const formTargetValid = !isNaN(formTargetValue) && formTargetValue > 0
  const formWarning = num(form.warning_threshold)
  const formCritical = num(form.critical_threshold)
  const formTrend = num(form.trend_drop_periods)
  const formThresholdsValid = !isNaN(formWarning) && !isNaN(formCritical) && formWarning >= 0 && formWarning <= 100 && formCritical >= 0 && formCritical <= formWarning
  const formTrendValid = Number.isInteger(formTrend) && formTrend >= 2 && formTrend <= 12
  const formGroupTotal =
    kpis
      .filter((k) => (k.objective_id ?? null) === formObjId)
      .filter((k) => formObjId !== null || (k.category || 'Work') === form.category)
      .reduce((s, k) => s + (k.weight || 0), 0) + formW

  const submit = async (e) => {
    e.preventDefault()
    if (!ensureCycleBeforeEdit()) return
    if (activeCycle?.is_locked) {
      setError(tr('cycle.locked_edit_error'))
      return
    }
    try {
      await api.createKpi({
        ...form,
        weight: formW,
        target_value: formTargetValue,
        warning_threshold: formWarning,
        critical_threshold: formCritical,
        trend_drop_periods: formTrend,
        alert_muted_until: form.alert_muted_until || null,
        deadline: form.deadline || null,
        objective_id: form.objective_id ? Number(form.objective_id) : null,
      })
      setForm(EMPTY)
      setShowForm(false)
      load()
    } catch (err) { setError(err.message) }
  }

  const _afterImportSuccess = async (created, mode = 'normal') => {
    toast.success(tr('kpis.import_success', { count: created.length }))
    load()
    const unassigned = created.filter(k => !k.objective_name)
    if (unassigned.length === 0) return

    if (mode === 'agent_map') {
      // Goi endpoint rieng — khong tao chat session, tu dong luu khong can confirm them
      setImportAnalyzing(true)
      try {
        await api.autoMapKpis(unassigned.map(k => k.id))
        toast.success(tr('kpis.import_agent_confirm_success'))
        load()
      } catch (err) { setError(err.message) } finally { setImportAnalyzing(false) }
      return
    }

    // Flat import (khong co mode cu the): van dung sendChat + panel xac nhan
    setImportAnalyzing(true)
    setImportSuggestion(null)
    setImportChatDraft(null)
    const kpiList = unassigned.map(k => `- ${k.name}${k.description ? ` (${k.description})` : ''}`).join('\n')
    const objNames = objectives.map(o => o.name).join(', ') || tr('kpis.none_plain')
    const msg = tr('kpis.import_auto_map_prompt', {
      count: unassigned.length,
      kpis: kpiList,
      objectives: objNames,
    }).replaceAll('\\n', '\n')
    try {
      const res = await api.sendChat(msg)
      setImportSuggestion(res || null)
    } catch { /* non-blocking */ } finally { setImportAnalyzing(false) }
  }

  const analyzeFreeformImportWithAgent = async (file) => {
    setImportAnalyzing(true)
    setImportSuggestion(null)
    setImportChatDraft(null)
    const objNames = objectives.map(o => o.name).join(', ') || tr('kpis.none_plain')
    const msg = tr('kpis.import_freeform_prompt', {
      file: file?.name || 'Excel',
      objectives: objNames,
      cycle: activeCycle?.name || tr('kpis.none_plain'),
    }).replaceAll('\\n', '\n')
    try {
      const attachment = await api.uploadChatAttachment(file)
      const draft = { message: msg, attachments: [attachment] }
      setImportChatDraft(draft)
      const res = await api.sendChat(msg, null, lang, draft.attachments, 120000, null, false)
      setImportSuggestion(res || null)
    } catch (err) {
      setImportChatDraft(null)
      setError(err.message)
    } finally {
      setImportAnalyzing(false)
    }
  }

  const importFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!ensureCycleBeforeEdit()) return
    if (activeCycle?.is_locked) {
      setError(tr('cycle.locked_import_error'))
      return
    }
    setError('')
    setImportConflict(null)
    setImportSuggestion(null)
    setImportChatDraft(null)
    setPendingImportFile(null)
    setImportFileLoading(true)
    try {
      // Thu preview (chi ho tro dinh dang Performance Appraisal)
      const preview = await api.previewImport(file, activeCycleId)
      setImportWizard({ preview })
    } catch (previewErr) {
      // not_appraisal: dung chung co che doc attachment cua Tro ly AI va de Agent suy luan.
      if (previewErr._type === 'not_appraisal') {
        setImportFileLoading(false)
        await analyzeFreeformImportWithAgent(file)
      } else {
        setError(previewErr.message)
      }
    } finally {
      setImportFileLoading(false)
    }
  }

  const handleImportConflictChoice = async (choice) => {
    const file = pendingImportFile
    setImportConflict(null)
    setPendingImportFile(null)
    if (!ensureCycleBeforeEdit()) return
    if (activeCycle?.is_locked) {
      setError(tr('cycle.locked_import_error'))
      return
    }
    setError('')
    setImportFileLoading(true)
    try {
      const created = await api.importKpis(file, choice, activeCycleId)
      await _afterImportSuccess(created, choice) // truyen mode de agent_map goi endpoint rieng
    } catch (err) { setError(err.message) } finally { setImportFileLoading(false) }
  }

  const confirmImportProposal = async () => {
    if (!importSuggestion) return
    if (activeCycle?.is_locked) {
      setError(tr('cycle.locked_confirm_import_error'))
      return
    }
    setConfirmingProposal(true)
    try {
      await api.confirmKpiProposal({
        objectives: importSuggestion.proposed_objectives || [],
        kpis: importSuggestion.proposed_kpis || [],
        weight_changes: importSuggestion.weight_changes || [],
        cycle_id: activeCycleId ?? null,
        source_mode: 'export',
      })
      toast.success(tr('kpis.import_agent_confirm_success'))
      setImportSuggestion(null)
      setImportChatDraft(null)
      load()
    } catch (err) { setError(err.message) } finally { setConfirmingProposal(false) }
  }

  const buildAiImportPreview = (suggestion) => {
    const proposedKpis = suggestion?.proposed_kpis || []
    if (proposedKpis.length === 0) return null

    const proposedObjectives = suggestion?.proposed_objectives || []
    const newObjByName = new Map(proposedObjectives.map((o) => [String(o.name || '').trim().toLowerCase(), o]))
    const existingById = new Map(objectives.map((o) => [Number(o.id), o]))
    const existingByName = new Map(objectives.map((o) => [String(o.name || '').trim().toLowerCase(), o]))
    const existingObjTotalsByCategory = ['Work', 'Personal'].reduce((acc, cat) => {
      acc[cat] = Math.round(objectives
        .filter((o) => (o.category || 'Work') === cat)
        .reduce((sum, o) => sum + Number(o.weight || 0), 0) * 10) / 10
      return acc
    }, {})
    const groups = new Map()

    const kpiTotalFor = (objectiveId, category = 'Work') => {
      const total = kpis
        .filter((k) => objectiveId != null
          ? Number(k.objective_id) === Number(objectiveId)
          : !k.objective_id && (k.category || 'Work') === category)
        .reduce((sum, k) => sum + Number(k.weight || 0), 0)
      return Math.round(total * 10) / 10
    }
    const ensureGroup = (key, base) => {
      if (!groups.has(key)) groups.set(key, { ...base, kpis: [] })
      return groups.get(key)
    }

    proposedObjectives.forEach((o) => {
      const name = String(o.name || '').trim()
      if (!name) return
      ensureGroup(`new:${name.toLowerCase()}`, {
        name,
        weight: Number(o.weight || 0),
        category: o.category || 'Work',
        is_new: true,
        objective_id: null,
        kpi_total: 0,
        existing_kpi_total: 0,
      })
    })

    proposedKpis.forEach((k) => {
      const objectiveName = String(k.objective_ref || k.objective_name || '').trim()
      const objectiveKey = objectiveName.toLowerCase()
      let group
      if (objectiveName && newObjByName.has(objectiveKey)) {
        const obj = newObjByName.get(objectiveKey)
        group = ensureGroup(`new:${objectiveKey}`, {
          name: obj.name,
          weight: Number(obj.weight || 0),
          category: obj.category || k.category || 'Work',
          is_new: true,
          objective_id: null,
          kpi_total: 0,
          existing_kpi_total: 0,
        })
      } else if (k.objective_id && existingById.has(Number(k.objective_id))) {
        const obj = existingById.get(Number(k.objective_id))
        group = ensureGroup(`existing:${obj.id}`, {
          name: obj.name,
          weight: Number(obj.weight || 0),
          category: obj.category || k.category || 'Work',
          is_new: false,
          objective_id: obj.id,
          kpi_total: 0,
          existing_kpi_total: kpiTotalFor(obj.id, obj.category || 'Work'),
        })
      } else if (objectiveName && existingByName.has(objectiveKey)) {
        const obj = existingByName.get(objectiveKey)
        group = ensureGroup(`existing:${obj.id}`, {
          name: obj.name,
          weight: Number(obj.weight || 0),
          category: obj.category || k.category || 'Work',
          is_new: false,
          objective_id: obj.id,
          kpi_total: 0,
          existing_kpi_total: kpiTotalFor(obj.id, obj.category || 'Work'),
        })
      } else if (objectiveName) {
        group = ensureGroup(`new:${objectiveKey}`, {
          name: objectiveName,
          weight: 0,
          category: k.category || 'Work',
          is_new: true,
          objective_id: null,
          kpi_total: 0,
          existing_kpi_total: 0,
        })
      } else {
        const cat = k.category || 'Work'
        const label = cleanIconLabel(tr(`category.${cat === 'Personal' ? 'personal' : 'work'}`))
        group = ensureGroup(`unassigned:${cat}`, {
          name: `${tr('kpis.import_ai_unassigned')} (${label})`,
          weight: 0,
          category: cat,
          is_new: false,
          objective_id: null,
          kpi_total: 0,
          existing_kpi_total: kpiTotalFor(null, cat),
        })
      }

      const weight = Number(k.weight || 0)
      group.kpi_total += weight
      group.kpis.push({
        name: k.name,
        description: k.description || '',
        note: k.description || '',
        target: k.target || '',
        unit: k.unit || '%',
        target_value: Number.isFinite(Number(k.target_value)) ? Number(k.target_value) : 100,
        deadline: k.deadline || null,
        weight,
        has_weight: weight > 0,
        category: k.category || group.category || 'Work',
      })
    })

    const objectivesPreview = Array.from(groups.values()).filter((g) => g.kpis.length > 0)
    const needsWeightInput = objectivesPreview.some((o) =>
      (o.is_new && Number(o.weight || 0) === 0) || o.kpis.some((k) => !k.has_weight)
    )
    return {
      existing_obj_total: Math.max(existingObjTotalsByCategory.Work || 0, existingObjTotalsByCategory.Personal || 0),
      existing_obj_totals_by_category: existingObjTotalsByCategory,
      objectives: objectivesPreview,
      messages: [],
      can_save: objectivesPreview.length > 0,
      needs_weight_input: needsWeightInput,
    }
  }

  const openFormForGroup = (objId) => {
    if (!ensureCycleBeforeEdit()) return
    if (activeCycle?.is_locked) {
      setError(tr('cycle.locked_add_error'))
      return
    }
    const obj = objectives.find((o) => o.id === objId)
    setForm({ ...EMPTY, objective_id: objId ? String(objId) : '', category: obj?.category || activeCategory })
    setShowForm(true)
    setTimeout(() => formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const analyzeConflicts = async (manual = true) => {
    setAnalyzing(true)
    setError('')
    try {
      const res = await api.analyzeConflicts(activeCycleId)
      _conflictCacheResult = res.conflicts
      setConflicts(res.conflicts)
      if (res.conflicts.length) {
        setConflictsHidden(!manual)
        setConflictsClosed(false)
      } else if (manual) {
        toast.success(tr('kpis.conflict_none'))
      }
    } catch (e) {
      setError(e.message)
      _conflictCacheSignature = null // allow retry next visit
    } finally { setAnalyzing(false) }
  }

  const conflictKpiIds = new Set((conflicts || []).flatMap((c) => c.kpi_ids))

  const removeObjective = (o) => setRemoveObjConfirm(o)
  const doRemoveObjective = async () => {
    if (!removeObjConfirm) return
    if (activeCycle?.is_locked) {
      setError(tr('cycle.locked_remove_objective_error'))
      setRemoveObjConfirm(null)
      return
    }
    await api.deleteObjective(removeObjConfirm.id)
    setRemoveObjConfirm(null)
    load()
  }

  const actions = {
    decompose: async (id) => {
      if (activeCycle?.is_locked) {
        setError(tr('cycle.locked_decompose_error'))
        return
      }
      setBusyId(id)
      setError('')
      try {
        await api.decomposeKpi(id)
        await load()
        setExpanded(id)
      } catch (err) { setError(err.message) } finally { setBusyId(null) }
    },
    archive: (kpi) => activeCycle?.is_locked ? setError(tr('cycle.locked_archive_error')) : setArchivePrompt(kpi),
    edit: (kpi) => activeCycle?.is_locked ? setError(tr('cycle.locked_edit_kpi_error')) : setEditing(kpi),
    toggleExpand: (id) => setExpanded(expanded === id ? null : id),
    toggleMetrics: (id) => {
      setMetricsPeriodKey('')
      setMetricsOpen(metricsOpen === id ? null : id)
    },
    toggleLog: async (id) => {
      if (changelog[id]) { setChangelog((c) => ({ ...c, [id]: null })); return }
      const logs = await api.kpiChangelog(id)
      setChangelog((c) => ({ ...c, [id]: logs }))
    },
    smartCheck: async (id) => {
      if (smartResults[id]) { setSmartResults((r) => ({ ...r, [id]: null })); return }
      setSmartLoadingId(id)
      try {
        const res = await api.smartValidateKpi(id)
        setSmartResults((r) => ({ ...r, [id]: res }))
      } catch (err) { setError(err.message) } finally { setSmartLoadingId(null) }
    },
  }

  const doArchive = async (reason) => {
    if (!archivePrompt) return
    if (activeCycle?.is_locked) {
      setError(tr('cycle.locked_archive_error'))
      setArchivePrompt(null)
      return
    }
    await api.deleteKpi(archivePrompt.id, reason)
    setArchivePrompt(null)
    load()
  }

  const doBalance = async () => {
    if (!balancePending) return
    if (activeCycle?.is_locked) {
      setError(tr('cycle.locked_balance_error'))
      setBalancePending(null)
      return
    }
    try {
      await api.balanceWeights(balancePending.objId, balancePending.category || activeCategory)
      load()
    } catch (e) { setError(e.message) } finally { setBalancePending(null) }
  }

  const doCycleLockChange = async (reason) => {
    if (!activeCycleId || !cycleLockPrompt) return
    if (!reason.trim()) {
      setError(tr('cycle.reason_required'))
      return
    }
    try {
      if (cycleLockPrompt === 'lock') {
        await api.lockCycle(activeCycleId, reason.trim())
        toast.success(tr('cycle.lock_success'))
      } else {
        await api.unlockCycle(activeCycleId, reason.trim())
        toast.success(tr('cycle.unlock_success'))
      }
      setCycleLockPrompt(null)
      await fetchCycles()
      await load()
    } catch (e) {
      setError(e.message)
      setCycleLockPrompt(null)
    }
  }

  // loc theo che do hien thi toan cuc (Work/Personal)
  const visibleKpis = kpis.filter((k) => matchView(mode, k.category))
  const visibleObjectives = objectives.filter((o) => (o.category || 'Work') === activeCategory)
  const groups = [
    ...visibleObjectives.map((o) => ({ obj: o, kpis: visibleKpis.filter((k) => k.objective_id === o.id) })),
    { obj: null, kpis: visibleKpis.filter((k) => !k.objective_id) },
  ].filter((g) => g.obj || g.kpis.length > 0)
  const aiImportPreview = importSuggestion ? buildAiImportPreview(importSuggestion) : null
  const clearImportSuggestion = () => {
    setImportSuggestion(null)
    setImportChatDraft(null)
    setImportChatOpening(false)
  }

  const openImportChat = async () => {
    if (importChatOpening) return
    const sid = importSuggestion?.session_id
    if (sid) {
      clearImportSuggestion()
      navigate(`/chat?session_id=${sid}`)
      return
    }
    if (importSuggestion && importChatDraft) {
      setImportChatOpening(true)
      try {
        const saved = await api.persistChatResponse(
          importChatDraft.message,
          importSuggestion,
          lang,
          importChatDraft.attachments,
        )
        setImportSuggestion(null)
        setImportChatDraft(null)
        navigate(saved?.session_id ? `/chat?session_id=${saved.session_id}` : '/chat')
      } catch (err) {
        setError(err.message)
      } finally {
        setImportChatOpening(false)
      }
      return
    }
    clearImportSuggestion()
    navigate('/chat')
  }

  const exportAppraisalFile = async () => {
    if (exportAppraisalLoading) return
    setExportAppraisalLoading(true)
    setError('')
    try {
      await api.exportAppraisal(activeCycleId)
    } catch (err) {
      setError(err.message)
    } finally {
      setExportAppraisalLoading(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1 className="page-title-with-icon"><UiIcon name="target" /> {cleanIconLabel(tr('kpis.title'))}</h1>
          <p>{tr('kpis.subtitle')}</p>
        </div>
        <div className="header-actions">
          {activeKpiTab === 'list' && (
            <>
              {analyzing && <span className="muted conflict-scanning">{tr('kpis.conflict_analyzing')}</span>}
              {!analyzing && conflictsClosed && conflicts?.length > 0 && (
                <button className="btn" onClick={() => { setConflictsClosed(false); setConflictsHidden(false) }}>
                  <UiIcon name="warning" />
                  {tr('kpis.conflict_reopen', { count: conflicts.length })}
                </button>
              )}
              <button className="btn" disabled={analyzing || visibleKpis.length < 2} onClick={() => analyzeConflicts(true)}>
                <UiIcon name="scan" />
                {tr('kpis.conflict_review')}
              </button>
              <button
                className={`btn ${exportAppraisalLoading ? 'is-loading' : ''}`}
                title={tr('kpis.btn_export_appraisal_tip')}
                disabled={exportAppraisalLoading}
                aria-busy={exportAppraisalLoading}
                onClick={exportAppraisalFile}
              >
                <UiIcon name={exportAppraisalLoading ? 'refresh' : 'fileSpreadsheet'} />
                {exportAppraisalLoading ? tr('kpis.export_btn_loading') : cleanIconLabel(tr('kpis.btn_export_appraisal'))}
              </button>
              <button className="btn" onClick={() => api.exportEvaluation(activeCycleId).catch((e) => setError(e.message))}>
                <UiIcon name="download" />
                {cleanIconLabel(tr('kpis.btn_export'))}
              </button>
              <button className="btn" onClick={openShareModal} disabled={!activeCycleId} title={tr('share.overview_tip')}>
                <UiIcon name="share" />
                {tr('share.overview_btn')}
              </button>
              <button className={`btn ${!activeCycleId ? 'primary' : ''}`} onClick={() => setShowNewCycleModal(true)}>
                <UiIcon name="calendar" />
                {tr('cycle.create')}
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={importFile} />
              {activeCycleId && (
                <button
                  className={`btn ${activeCycle?.is_locked ? 'primary' : ''}`}
                  onClick={() => setCycleLockPrompt(activeCycle?.is_locked ? 'unlock' : 'lock')}
                >
                  <UiIcon name={activeCycle?.is_locked ? 'unlock' : 'lock'} />
                  {cleanIconLabel(activeCycle?.is_locked ? tr('cycle.unlock_action') : tr('cycle.lock_action'))}
                </button>
              )}
              {activeCycleId && (
                <button className="btn" title={tr('cycle.clone_tip')} onClick={openCloneModal}>
                  <UiIcon name="copy" />
                  {cleanIconLabel(tr('cycle.clone'))}
                </button>
              )}
              <button className="btn" disabled={activeCycle?.is_locked} onClick={() => ensureCycleBeforeEdit() && setObjModal({})}>
                <UiIcon name="plus" />
                {cleanIconLabel(tr('kpis.btn_add_obj'))}
              </button>
            </>
          )}
        </div>
      </header>

      {activeKpiTab === 'list' && <ViewModeSwitch />}
      <div className="period-tabs kpi-page-tabs">
        <button className={`period-tab ${activeKpiTab === 'list' ? 'active' : ''}`} onClick={() => setActiveKpiTab('list')}>
          <UiIcon name="target" />{cleanIconLabel(tr('kpis.tab_list'))}
        </button>
        <button className={`period-tab ${activeKpiTab === 'history' ? 'active' : ''}`} onClick={() => setActiveKpiTab('history')}>
          <UiIcon name="clock" />{cleanIconLabel(tr('kpis.tab_history'))}
        </button>
      </div>
      {activeKpiTab === 'history' && <KpiChangeHistory />}
      <div className={activeKpiTab === 'list' ? 'kpi-main-panel' : 'kpi-main-panel kpi-panel-hidden'}>
      {exportAppraisalLoading && <ExportFocusLoading tr={tr} />}

      <KpiCockpit
        objectives={objectives}
        visibleKpis={visibleKpis}
        conflicts={conflicts || []}
        totalObjWeight={totalObjWeight}
        locked={!!activeCycle?.is_locked}
        importLoading={importBusy}
        tr={tr}
        onShowConflicts={() => { setConflictsClosed(false); setConflictsHidden(false) }}
        onAddKpi={() => {
          if (!ensureCycleBeforeEdit()) return
          if (activeCycle?.is_locked) setError(tr('cycle.locked_add_error'))
          else setShowForm((v) => !v)
        }}
        onImport={() => {
          if (!ensureCycleBeforeEdit()) return
          if (!importBusy) fileRef.current?.click()
        }}
      />

      {importBusy && <ImportFocusLoading tr={tr} />}

      {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}

      {!activeCycleId && cycles.length === 0 && (
        <div className="card cycle-empty-state">
          <div>
            <h3><UiIcon name="calendar" /> {tr('cycle.empty_title')}</h3>
            <p>{tr('cycle.empty_desc')}</p>
          </div>
          <button className="btn primary" onClick={() => setShowNewCycleModal(true)}>
            <UiIcon name="plus" />
            {tr('cycle.create_new')}
          </button>
        </div>
      )}

      {showNewCycleModal && (
        <NewCycleModal
          currentYear={currentYear}
          tr={tr}
          onClose={() => setShowNewCycleModal(false)}
          onCreated={onCycleCreated}
        />
      )}

      {importWizard && (
        <ImportWizard
          preview={importWizard.preview}
          objectives={objectives}
          kpis={kpis}
          cycleId={activeCycleId}
          tr={tr}
          onClose={() => setImportWizard(null)}
          onSaved={() => {
            setImportWizard(null)
            toast.success(tr('kpis.import_agent_confirm_success'))
            load()
          }}
        />
      )}

      {importConflict && (
        <div className="card import-conflict-panel">
          <h3 className="icon-heading"><UiIcon name="warning" /> {tr('kpis.import_conflict_title')}</h3>
          <p className="muted">{importConflict.message}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn" onClick={() => handleImportConflictChoice('ungrouped')}>
              {tr('kpis.import_conflict_opt1')}
            </button>
            <button className="btn primary" onClick={() => handleImportConflictChoice('agent_map')}>
              {tr('kpis.import_conflict_opt2')}
            </button>
            <button className="btn small ghost" onClick={() => { setImportConflict(null); setPendingImportFile(null) }}>
              {tr('kpis.conflict_close')}
            </button>
          </div>
        </div>
      )}

      {conflicts?.length > 0 && !conflictsClosed && (
        <div className="card conflict-panel has-conflicts">
          <div className="row">
            <h3>{tr('kpis.conflict_panel_title', { count: conflicts.length })}</h3>
            <div className="conflict-panel-actions">
              <button className="btn small ghost" onClick={() => setConflictsHidden((v) => !v)}>
                {conflictsHidden ? tr('kpis.conflict_show') : tr('kpis.conflict_hide')}
              </button>
              <button className="btn small ghost" onClick={() => setConflictsClosed(true)}>
                {tr('kpis.conflict_close')}
              </button>
            </div>
          </div>
          {conflictsHidden && (
            <div className="conflict-summary-strip">
              <strong>{conflicts[0]?.kpi_names?.slice(0, 2).join(' ↔ ')}</strong>
              <span>
                {conflicts[0]?.conflict_score != null && (
                  <b className={`conflict-score ${conflicts[0].conflict_score >= conflictWarningScore ? 'warn' : ''}`}>
                    {tr('kpis.conflict_score', { value: Math.round(Number(conflicts[0].conflict_score || 0) * 100) })}
                  </b>
                )}
                {conflicts[0]?.suggestion || tr('kpis.conflict_fallback_suggestion')}
              </span>
            </div>
          )}
          {!conflictsHidden && conflicts.map((c, i) => (
            <div key={i} className={`conflict-item sev-${c.severity}`}>
              <div className="conflict-head">
                <span className={`sev-badge sev-${c.severity}`}>
                  {tr(`kpis.conflict_sev_${c.severity}`)}
                </span>
                {c.conflict_score != null && (
                  <span className={`conflict-score ${c.conflict_score >= conflictWarningScore ? 'warn' : ''}`}>
                    {tr('kpis.conflict_score', { value: Math.round(Number(c.conflict_score || 0) * 100) })}
                  </span>
                )}
                <strong>{c.kpi_names.join(' ↔ ')}</strong>
              </div>
              <p><b>{tr('kpis.conflict_why')}</b> {c.explanation}</p>
              {c.suggestion && <p className="conflict-suggestion"><span className="inline-ui-icon"><UiIcon name="sparkles" /></span> <b>{tr('kpis.conflict_suggestion')}</b> {c.suggestion}</p>}
            </div>
          ))}
        </div>
      )}

      {importSuggestion && aiImportPreview && (
        <ImportWizard
          preview={aiImportPreview}
          objectives={objectives}
          kpis={kpis}
          cycleId={activeCycleId}
          tr={tr}
          aiReply={importSuggestion.reply || ''}
          forceAssignStep
          weightChanges={importSuggestion.weight_changes || []}
          onOpenChat={openImportChat}
          chatOpening={importChatOpening}
          onClose={clearImportSuggestion}
          onSaved={() => {
            setImportSuggestion(null)
            setImportChatDraft(null)
            toast.success(tr('kpis.import_agent_confirm_success'))
            load()
          }}
        />
      )}

      {importSuggestion && !aiImportPreview && (
        <AiImportResponseModal
          suggestion={importSuggestion}
          tr={tr}
          onClose={clearImportSuggestion}
          onOpenChat={openImportChat}
          chatOpening={importChatOpening}
        />
      )}

      {false && (importAnalyzing || importSuggestion) && (
        <div className="card import-suggestion-panel">
          <div className="row">
            <h3 className="icon-heading"><UiIcon name="bot" /> {tr('kpis.import_agent_result')}</h3>
            {importSuggestion && (
              <button className="btn small ghost" onClick={() => setImportSuggestion(null)}>
                {tr('kpis.conflict_close')}
              </button>
            )}
          </div>
          {importAnalyzing ? (
            <p className="muted">{tr('kpis.import_agent_analyzing')}</p>
          ) : importSuggestion && (
            <>
              {importSuggestion.reply && (
                <p style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{importSuggestion.reply}</p>
              )}
              {((importSuggestion.proposed_objectives?.length > 0) || (importSuggestion.proposed_kpis?.length > 0)) && (
                <div className="import-proposal-confirm">
                  {importSuggestion.proposed_objectives?.length > 0 && (
                    <div className="proposal-group">
                      <p className="proposal-label">{tr('kpis.import_agent_proposed_obj', { count: importSuggestion.proposed_objectives.length })}</p>
                      <ul className="proposal-list">
                        {importSuggestion.proposed_objectives.map((o, i) => (
                          <li key={i}><b>{o.name}</b>{o.weight > 0 ? ` — ${o.weight}%` : ''}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {importSuggestion.proposed_kpis?.length > 0 && (
                    <div className="proposal-group">
                      <p className="proposal-label">{tr('kpis.import_agent_proposed_kpi', { count: importSuggestion.proposed_kpis.length })}</p>
                      <ul className="proposal-list">
                        {importSuggestion.proposed_kpis.map((k, i) => (
                          <li key={i}>
                            <b>{k.name}</b>
                            {k.objective_name && <span className="muted"> → {k.objective_name}</span>}
                            {k.weight > 0 && <span className="muted"> ({k.weight}%)</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="row" style={{ gap: 8, marginTop: 12 }}>
                    <button className="btn primary" disabled={confirmingProposal} onClick={confirmImportProposal}>
                      {confirmingProposal ? '…' : cleanIconLabel(tr('kpis.import_agent_confirm'))}
                    </button>
                    <button className="btn small ghost" onClick={() => setImportSuggestion(null)}>
                      {tr('kpis.import_agent_cancel')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div ref={formAnchorRef} />
      {showForm && (
        <form className="card kpi-form" onSubmit={submit}>
          <div className="kpi-form-stack">
            <input required placeholder={tr('kpis.placeholder_name')} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder={tr('kpis.placeholder_target')} value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })} />
          </div>

          <div className="kpi-form-grid kpi-form-context">
            <label className="kpi-form-field">{tr('kpis.form_objective')}
              <select value={form.objective_id} onChange={(e) => {
                const value = e.target.value
                const obj = objectives.find((o) => String(o.id) === String(value))
                setForm({ ...form, objective_id: value, category: obj?.category || form.category })
              }}>
                <option value="">{tr('kpis.form_none')}</option>
                {objectives.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label>{tr('kpis.form_category')}
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="Work">{cleanIconLabel(tr('category.work'))}</option>
                <option value="Personal">{cleanIconLabel(tr('category.personal'))}</option>
              </select>
            </label>
            <label className="kpi-form-field">{tr('kpis.form_unit')}
              <input placeholder={tr('kpis.unit_placeholder')} value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </label>
          </div>

          <div className="kpi-form-grid kpi-form-measure">
            <label className="kpi-form-field">{tr('kpis.form_target_value')}
              <NumberStepper min="0" step="any" className="inline" value={form.target_value}
                onChange={(value) => setForm({ ...form, target_value: normalizeNonNegativeInput(value) })} />
            </label>
            <label className="kpi-form-field">{tr('kpis.weight_label')}
              <NumberStepper min="0" max="100" step="1" className="inline" value={form.weight}
                onChange={(value) => setForm({ ...form, weight: normalizeWeightInput(value) })} />
            </label>
            <label className="kpi-form-field">{tr('kpis.deadline_label')}
              <input type="date" value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </label>
          </div>

          <div className="kpi-form-grid kpi-form-ops">
            <label className="kpi-form-field">{tr('input.cadence')}
              <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
                {CADENCES.map((opt) => <option key={opt} value={opt}>{tr(`input.cadence_${opt}`)}</option>)}
              </select>
            </label>
            <label className="kpi-form-field">{tr('input.target_mode')}
              <select value={form.target_mode} onChange={(e) => setForm({ ...form, target_mode: e.target.value })}>
                {TARGET_MODES.map((opt) => <option key={opt} value={opt}>{tr(`input.target_${opt}`)}</option>)}
              </select>
            </label>
          </div>

          <div className="kpi-form-grid kpi-form-alerts">
            <label className="kpi-form-field">{tr('input.warning_short')}
              <NumberStepper min="0" max="100" step="1" className="inline" value={form.warning_threshold}
                onChange={(value) => setForm({ ...form, warning_threshold: normalizePercentInput(value) })} />
            </label>
            <label className="kpi-form-field">{tr('input.critical_short')}
              <NumberStepper min="0" max="100" step="1" className="inline" value={form.critical_threshold}
                onChange={(value) => setForm({ ...form, critical_threshold: normalizePercentInput(value) })} />
            </label>
            <label className="kpi-form-field">{tr('input.trend_short')}
              <NumberStepper min="2" max="12" step="1" className="inline" value={form.trend_drop_periods}
                onChange={(value) => setForm({ ...form, trend_drop_periods: normalizeTrendInput(value) })} />
            </label>
            <label className="kpi-form-field">{tr('input.alert_muted_until')}
              <input type="date" value={form.alert_muted_until}
                onChange={(e) => setForm({ ...form, alert_muted_until: e.target.value })} />
            </label>
          </div>
          {!formThresholdsValid && <div className="weight-hint red">{tr('input.threshold_invalid')}</div>}
          {formW > 0 && (
            <WeightHint total={formGroupTotal} tr={tr}
              label={tr('wh.kpi_group', { name: formObjId ? objectives.find((o) => o.id === formObjId)?.name : tr('kpis.ungrouped_plain') })} />
          )}
          <div className="kpi-form-actions">
            <button className="btn primary" type="submit"
              disabled={activeCycle?.is_locked || !formWeightValid || !formTargetValid || !formThresholdsValid || !formTrendValid || formGroupTotal > 100}>
              {tr('kpis.save_btn')}
            </button>
          </div>
        </form>
      )}

      {editing && (
        <EditKpiModal kpi={editing} kpis={kpis} objectives={objectives} tr={tr}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
      {objModal && (
        <ObjectiveModal objective={objModal.id ? objModal : null} objectives={objectives} tr={tr}
          cycleId={activeCycleId}
          onClose={() => setObjModal(null)} onSaved={() => { setObjModal(null); load() }} />
      )}
      <ConfirmModal
        open={!!removeObjConfirm}
        title={tr('kpis.obj_remove_tip')}
        message={removeObjConfirm ? tr('kpis.obj_remove_confirm', { name: removeObjConfirm.name }) : ''}
        confirmLabel={tr('kpis.obj_remove_tip')}
        confirmVariant="danger"
        onConfirm={doRemoveObjective}
        onCancel={() => setRemoveObjConfirm(null)}
      />
      <ConfirmModal
        open={!!balancePending}
        title={tr('kpis.balance_btn')}
        message={balancePending ? tr('kpis.balance_confirm', { count: balancePending.count }) : ''}
        confirmLabel={tr('kpis.balance_btn')}
        onConfirm={doBalance}
        onCancel={() => setBalancePending(null)}
      />
      <PromptModal
        open={!!archivePrompt}
        title={tr('kpis.tip_archive')}
        message={archivePrompt ? tr('kpis.archive_prompt', { name: archivePrompt.name }) : ''}
        placeholder={tr('kpim.reason_ph')}
        confirmLabel={tr('kpis.tip_archive')}
        onConfirm={doArchive}
        onCancel={() => setArchivePrompt(null)}
      />
      <PromptModal
        open={!!cycleLockPrompt}
        title={cycleLockPrompt === 'lock' ? tr('cycle.lock_kpi_title') : tr('cycle.unlock_kpi_title')}
        message={
          cycleLockPrompt === 'lock'
            ? tr('cycle.lock_confirm', { name: activeCycle?.name || '' })
            : tr('cycle.unlock_confirm', { name: activeCycle?.name || '' })
        }
        placeholder={tr('cycle.reason_placeholder')}
        confirmLabel={cycleLockPrompt === 'lock' ? tr('cycle.lock_confirm_label') : tr('cycle.unlock_confirm_label')}
        onConfirm={doCycleLockChange}
        onCancel={() => setCycleLockPrompt(null)}
      />
      <Modal
        open={showShareModal}
        title={tr('share.overview_title')}
        onClose={() => setShowShareModal(false)}
        actions={<button className="btn" onClick={() => setShowShareModal(false)}>{tr('common.close')}</button>}
      >
        <div className="share-modal-intro">
          <div className="share-modal-icon" aria-hidden="true">↗</div>
          <div>
            <b>{tr('share.readonly_link')}</b>
            <p>{tr('share.readonly_desc')}</p>
          </div>
        </div>
        <div className="share-create-row">
          <label>{tr('share.expires_after')}</label>
          <select value={shareExpireDays} onChange={e => setShareExpireDays(Number(e.target.value))}
            className="share-expiry-select">
            {[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{tr('share.days', { days: d })}</option>)}
          </select>
          <button className="btn primary small" onClick={createShareLink} disabled={shareBusy || !activeCycleId}>
            {shareBusy ? tr('share.creating') : tr('share.create_link')}
          </button>
        </div>
        {!activeCycleId && <p style={{ color: '#ca8a04', fontSize: 13 }}>{tr('share.pick_cycle')}</p>}
        {shareLinks.length === 0
          ? <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{tr('share.empty')}</p>
          : shareLinks.map(link => {
            const url = `${window.location.origin}/shared/${link.token}`
            const expired = new Date(link.expires_at) < new Date()
            const revoked = !!link.revoked_at
            const invalid = expired || revoked
            const state = revoked ? tr('share.revoked') : expired ? tr('share.expired') : tr('share.active')
            const locale = lang === 'vi' ? 'vi-VN' : 'en-US'
            return (
              <div key={link.token} className={`share-link-item${invalid ? ' invalid' : ''}`}>
                <div className="share-link-main">
                  <div className="share-link-head">
                    <span className={`share-link-state${invalid ? ' invalid' : ''}`}>{state}</span>
                    <span className="share-link-meta">{tr('share.expires_on', { date: new Date(link.expires_at).toLocaleDateString(locale) })}</span>
                  </div>
                  <div className={`share-link-url${invalid ? ' share-link-revoked' : ''}`}>{url}</div>
                  <div className="share-link-meta">
                    {revoked && tr('share.revoked_meta')}{expired && !revoked && tr('share.expired_meta')}
                  </div>
                </div>
                <div className="share-link-actions">
                  {!invalid && (
                    <button className="btn small" onClick={() => copyShareLink(link.token)}>
                      {shareCopied === link.token ? tr('share.copied') : tr('share.copy')}
                    </button>
                  )}
                  {!revoked && (
                    <button className="btn small" style={{ color: '#dc2626' }} onClick={() => revokeShareLink(link.token)}>
                      {tr('common.cancel')}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        }
      </Modal>

      {groups.map(({ obj, kpis: groupKpis }) => {
        const sumW = Math.round(groupKpis.reduce((s, k) => s + (k.weight || 0), 0) * 10) / 10
        const sumCls = sumW === 100 ? 'green' : sumW > 100 ? 'red' : 'yellow'
        const balance = () => setBalancePending({ objId: obj?.id ?? null, count: groupKpis.length, category: obj?.category || activeCategory })
        const objId = obj?.id ?? 'none'
        const { items: paginatedKpis, page, totalPages } = paginate(groupKpis, objId)
        const needsPagination = groupKpis.length > ITEMS_PER_PAGE

        return (
          <section className="objective-group" key={objId}>
            <div className="objective-head">
              <div className="objective-title">
                <h2>
                  {obj ? obj.name : tr('kpis.ungrouped')}
                </h2>
                {obj && (
                  <span className="obj-stats">
                    <span className="obj-stat">{tr('kpis.obj_weight')} <b>{obj.weight}%</b></span>
                    <span className="obj-stat"><b>{groupKpis.length}</b> KPI</span>
                    <span className="obj-stat">{tr('kpis.obj_progress')} <b>{obj.progress}%</b></span>
                  </span>
                )}
                {groupKpis.length > 0 && (
                  <span className={`sum-chip ${sumCls}`} title={tr('kpis.sum_chip_tip')}>
                    Σ KPI: {sumW}/100%
                    {sumW !== 100 && (
                      <button className="balance-btn" disabled={activeCycle?.is_locked} title={activeCycle?.is_locked ? tr('cycle.locked_tip') : tr('kpis.balance_tip')} onClick={balance}>
                        {tr('kpis.balance_btn')}
                      </button>
                    )}
                  </span>
                )}
              </div>
              {obj && (
                <div className="objective-tools">
                  <div className="objective-bar-wrap" aria-hidden="true">
                    <div className="progress-track objective-bar">
                      <div className="progress-fill gradient" style={{ width: `${Math.min(100, obj.progress)}%` }} />
                    </div>
                  </div>
                  <div className="objective-actions" aria-label={tr('kpis.obj_actions_label')}>
                    <button className="icon-btn" disabled={activeCycle?.is_locked} title={cleanIconLabel(activeCycle?.is_locked ? tr('cycle.locked_tip') : tr('objm.edit'))} onClick={() => setObjModal(obj)}><UiIcon name="edit" /></button>
                    <button className="icon-btn danger" disabled={activeCycle?.is_locked} title={activeCycle?.is_locked ? tr('cycle.locked_tip') : tr('kpis.obj_remove_tip')} onClick={() => removeObjective(obj)}><UiIcon name="trash" /></button>
                  </div>
                </div>
              )}
            </div>
            {groupKpis.length === 0 ? (
              <p className="muted objective-empty">{tr('kpis.group_empty')}</p>
            ) : (
              <>
                {paginatedKpis.map((kpi) => (
                  <KpiCard key={kpi.id} kpi={kpi} busyId={busyId} expanded={expanded} metricsOpen={metricsOpen} tr={tr}
                    metricsPeriodKey={metricsOpen === kpi.id ? metricsPeriodKey : ''}
                    changelog={changelog} smartResult={smartResults[kpi.id] ?? null}
                    smartLoadingId={smartLoadingId}
                    actions={actions} inConflict={conflictKpiIds.has(kpi.id)} locked={!!activeCycle?.is_locked} />
                ))}
                {needsPagination && totalPages > 1 && (
                  <div className="pagination">
                    <button className="btn small ghost" disabled={page <= 1}
                      onClick={() => setGroupPageNum(objId, page - 1)}>← {tr('pagination.prev')}</button>
                    <span className="pagination-info">{tr('pagination.page', { page, total: totalPages })}</span>
                    <button className="btn small ghost" disabled={page >= totalPages}
                      onClick={() => setGroupPageNum(objId, page + 1)}>{tr('pagination.next')} →</button>
                  </div>
                )}
              </>
            )}
          </section>
        )
      })}

      {/* D4: Clone Cycle Modal */}
      {showCloneModal && (
        <div className="modal-overlay" onClick={() => setShowCloneModal(false)}>
          <div className="modal clone-cycle-modal" onClick={e => e.stopPropagation()}>
            <h3>{tr('cycle.clone')}</h3>
            <div className="clone-summary">
              <div>
                <span className="clone-summary-label">{tr('cycle.clone_source')}</span>
                <b>{activeCycle?.name}</b>
              </div>
              <div>
                <span className="clone-summary-label">{tr('cycle.clone_copy')}</span>
                <b>{objectives.reduce((sum, obj) => sum + (obj.kpi_count || 0), 0)} KPI</b>
              </div>
              {activeCycle?.is_locked && (
                <span className="clone-locked-badge">{tr('cycle.locked_badge')}</span>
              )}
            </div>
            <div className="clone-rules">
              <div><b>{tr('cycle.clone_keep')}</b><span>{tr('cycle.clone_keep_desc')}</span></div>
              <div><b>{tr('cycle.clone_reset')}</b><span>{tr('cycle.clone_reset_desc')}</span></div>
            </div>
            <label className="modal-field">{tr('cycle.clone_new_name')}
              <input autoFocus value={cloneForm.name} onChange={e => setCloneForm({ ...cloneForm, name: e.target.value })} />
            </label>
            <div className="clone-date-row">
              <label className="modal-field">{tr('cycle.start_date')}
                <input type="date" value={cloneForm.start_date} onChange={e => setCloneForm({ ...cloneForm, start_date: e.target.value })} />
              </label>
              <label className="modal-field">{tr('cycle.end_date')}
                <input type="date" value={cloneForm.end_date} onChange={e => setCloneForm({ ...cloneForm, end_date: e.target.value })} />
              </label>
            </div>
            {objectives.length > 0 && (
              <div className="clone-objective-box">
                <label>{tr('cycle.clone_select_objectives')}</label>
                <div className="clone-objective-list">
                  {objectives.map(obj => (
                    <label key={obj.id} className="clone-objective-item">
                      <input type="checkbox"
                        checked={!cloneExcludes.includes(obj.id)}
                        onChange={() => setCloneExcludes(prev =>
                          prev.includes(obj.id) ? prev.filter(x => x !== obj.id) : [...prev, obj.id]
                        )} />
                      <span>{obj.name}</span>
                      <b>{obj.kpi_count || 0} KPI</b>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {cloneError && <div className="error-text"><UiIcon name="warning" /> {cloneError}</div>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowCloneModal(false)}>{tr('common.cancel')}</button>
              <button className="btn primary" disabled={cloneBusy || !cloneForm.name.trim()} onClick={doClone}>
                {cloneBusy ? tr('cycle.creating') : tr('cycle.create_new')}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
