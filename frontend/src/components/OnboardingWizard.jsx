import { useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'
import NumberStepper from './NumberStepper'
import { UiIcon } from './UiIcon'

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

const ROLE_KEYS = [
  'software_engineer',
  'project_manager',
  'sales',
  'finance',
  'marketing',
  'operations',
  'manager',
  'other',
]

const STEP_KEYS = ['welcome', 'cycle', 'first_kpi', 'done']

const ROLE_SUGGESTIONS = {
  software_engineer: [
    { nameKey: 'onboarding.suggestion.software_1.name', targetKey: 'onboarding.suggestion.software_1.target', unit: '%', targetValue: 90 },
    { nameKey: 'onboarding.suggestion.software_2.name', targetKey: 'onboarding.suggestion.software_2.target', unitKey: 'onboarding.unit.bug', targetValue: 12 },
  ],
  project_manager: [
    { nameKey: 'onboarding.suggestion.pm_1.name', targetKey: 'onboarding.suggestion.pm_1.target', unit: '%', targetValue: 95 },
    { nameKey: 'onboarding.suggestion.pm_2.name', targetKey: 'onboarding.suggestion.pm_2.target', unitKey: 'onboarding.unit.report', targetValue: 12 },
  ],
  sales: [
    { nameKey: 'onboarding.suggestion.sales_1.name', targetKey: 'onboarding.suggestion.sales_1.target', unitKey: 'onboarding.unit.million', targetValue: 500 },
    { nameKey: 'onboarding.suggestion.sales_2.name', targetKey: 'onboarding.suggestion.sales_2.target', unit: 'lead', targetValue: 30 },
  ],
  finance: [
    { nameKey: 'onboarding.suggestion.finance_1.name', targetKey: 'onboarding.suggestion.finance_1.target', unitKey: 'onboarding.unit.report', targetValue: 12 },
    { nameKey: 'onboarding.suggestion.finance_2.name', targetKey: 'onboarding.suggestion.finance_2.target', unit: '%', targetValue: 99 },
  ],
  marketing: [
    { nameKey: 'onboarding.suggestion.marketing_1.name', targetKey: 'onboarding.suggestion.marketing_1.target', unit: 'lead', targetValue: 200 },
    { nameKey: 'onboarding.suggestion.marketing_2.name', targetKey: 'onboarding.suggestion.marketing_2.target', unitKey: 'onboarding.unit.post', targetValue: 24 },
  ],
  operations: [
    { nameKey: 'onboarding.suggestion.ops_1.name', targetKey: 'onboarding.suggestion.ops_1.target', unit: '%', targetValue: 95 },
    { nameKey: 'onboarding.suggestion.ops_2.name', targetKey: 'onboarding.suggestion.ops_2.target', unitKey: 'onboarding.unit.incident', targetValue: 10 },
  ],
  manager: [
    { nameKey: 'onboarding.suggestion.manager_1.name', targetKey: 'onboarding.suggestion.manager_1.target', unit: '%', targetValue: 90 },
    { nameKey: 'onboarding.suggestion.manager_2.name', targetKey: 'onboarding.suggestion.manager_2.target', unitKey: 'onboarding.unit.session', targetValue: 12 },
  ],
  other: [
    { nameKey: 'onboarding.suggestion.other_1.name', targetKey: 'onboarding.suggestion.other_1.target', unit: '%', targetValue: 100 },
    { nameKey: 'onboarding.suggestion.other_2.name', targetKey: 'onboarding.suggestion.other_2.target', unitKey: 'onboarding.unit.time', targetValue: 12 },
  ],
}

const pad2 = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const num = (v) => parseFloat(String(v).replace(',', '.').replace('%', ''))

function cyclePreset(preset, baseYear, tr) {
  const now = new Date()
  if (preset === 'next_year') {
    const y = baseYear + 1
    return { name: tr('onboarding.cycle.year_name', { year: y }), type: 'yearly', start: `${y}-01-01`, end: `${y}-12-31` }
  }
  if (preset === 'quarter') {
    const q = Math.floor(now.getMonth() / 3) + 1
    const startMonth = (q - 1) * 3
    const start = new Date(baseYear, startMonth, 1)
    const end = new Date(baseYear, startMonth + 3, 0)
    return { name: tr('onboarding.cycle.quarter_name', { q, year: baseYear }), type: 'quarterly', start: iso(start), end: iso(end) }
  }
  if (preset === 'month') {
    const start = new Date(baseYear, now.getMonth(), 1)
    const end = new Date(baseYear, now.getMonth() + 1, 0)
    return { name: tr('onboarding.cycle.month_name', { month: pad2(now.getMonth() + 1), year: baseYear }), type: 'monthly', start: iso(start), end: iso(end) }
  }
  return { name: tr('onboarding.cycle.year_name', { year: baseYear }), type: 'yearly', start: `${baseYear}-01-01`, end: `${baseYear}-12-31` }
}

export default function OnboardingWizard({ onDone, replay = false }) {
  const { tr } = useLang()
  const currentYear = new Date().getFullYear()
  const defaultCycle = cyclePreset('year', currentYear, tr)
  const [step, setStep] = useState(0)
  const [role, setRole] = useState('')
  const [cycleKind, setCycleKind] = useState(defaultCycle.type)
  const [cycleName, setCycleName] = useState(defaultCycle.name)
  const [cycleStart, setCycleStart] = useState(defaultCycle.start)
  const [cycleEnd, setCycleEnd] = useState(defaultCycle.end)
  const [objectiveName, setObjectiveName] = useState(tr('onboarding.default_objective'))
  const [kpiName, setKpiName] = useState('')
  const [kpiTarget, setKpiTarget] = useState('')
  const [kpiUnit, setKpiUnit] = useState('%')
  const [kpiTargetValue, setKpiTargetValue] = useState(100)
  const [kpiCurrentValue, setKpiCurrentValue] = useState(0)
  const [kpiWeight, setKpiWeight] = useState(100)
  const [kpiDeadline, setKpiDeadline] = useState(defaultCycle.end)
  const [kpiCategory, setKpiCategory] = useState('Work')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdCycleId, setCreatedCycleId] = useState(null)
  const suggestions = ROLE_SUGGESTIONS[role || 'other'] || ROLE_SUGGESTIONS.other

  function suggestionValue(s) {
    return {
      name: tr(s.nameKey),
      target: tr(s.targetKey),
      unit: s.unitKey ? tr(s.unitKey) : s.unit,
      targetValue: s.targetValue,
    }
  }

  function applySuggestion(s) {
    const next = suggestionValue(s)
    setKpiName(next.name)
    setKpiTarget(next.target)
    setKpiUnit(next.unit)
    setKpiTargetValue(next.targetValue)
  }

  function applyCyclePreset(preset) {
    const c = cyclePreset(preset, currentYear, tr)
    setCycleKind(c.type)
    setCycleName(c.name)
    setCycleStart(c.start)
    setCycleEnd(c.end)
    setKpiDeadline(c.end)
    setError('')
  }

  function validateCycleForm() {
    if (!cycleName.trim()) return tr('onboarding.err_cycle_name')
    if (cycleStart && cycleEnd && cycleStart > cycleEnd) return tr('onboarding.err_cycle_dates')
    const match = cycleName.match(/\b(19\d{2}|20\d{2})\b/)
    const isYearlyName = cycleKind === 'yearly' || /\b(năm|nam|year)\b/i.test(cycleName)
    if (match && isYearlyName && cycleStart && cycleEnd) {
      const y = Number(match[1])
      if (new Date(cycleStart).getFullYear() !== y || new Date(cycleEnd).getFullYear() !== y) {
        return tr('onboarding.err_cycle_year_mismatch', { year: y })
      }
    }
    return ''
  }

  function handleQuickExit() {
    if (replay) onDone()
    else handleSkip()
  }

  async function handleSkip() {
    setSaving(true)
    try {
      await api.skipOnboarding()
    } catch (_) { /* ignore */ } finally {
      setSaving(false)
      onDone()
    }
  }

  async function handleStep1() {
    setStep(1)
  }

  async function handleStep2() {
    const formError = validateCycleForm()
    if (formError) { setError(formError); return }
    setError('')
    if (replay) { setStep(2); return }
    setSaving(true); setError('')
    try {
      const cycle = await api.createCycle({
        name: cycleName.trim(),
        cycle_type: cycleKind,
        start_date: cycleStart || null,
        end_date: cycleEnd || null,
      })
      setCreatedCycleId(cycle.id)
      setStep(2)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function handleStep3() {
    if (replay) { setStep(3); return }
    const tv = num(kpiTargetValue)
    const cv = num(kpiCurrentValue)
    const weight = num(kpiWeight)
    if (!objectiveName.trim()) { setError(tr('onboarding.err_objective_name')); return }
    if (!kpiName.trim()) { setError(tr('onboarding.err_kpi_name')); return }
    if (isNaN(tv) || tv <= 0) { setError(tr('onboarding.err_target_positive')); return }
    if (isNaN(cv) || cv < 0) { setError(tr('onboarding.err_actual_non_negative')); return }
    if (isNaN(weight) || weight < 0 || weight > 100 || !Number.isInteger(weight)) { setError(tr('onboarding.err_weight_range')); return }
    setSaving(true); setError('')
    try {
      if (kpiName.trim() && createdCycleId) {
        const obj = await api.createObjective({
          name: objectiveName.trim(),
          weight: 100,
          cycle_id: createdCycleId,
        })
        await api.createKpi({
          name: kpiName.trim(),
          target: kpiTarget.trim(),
          unit: kpiUnit.trim() || '%',
          target_value: tv,
          current_value: cv,
          weight,
          deadline: kpiDeadline || null,
          category: kpiCategory,
          objective_id: obj.id,
        })
      }
      await api.completeOnboarding(role ? tr(`onboarding.role.${role}`) : '')
      setStep(3)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function handleFinish() {
    try { await api.completeOnboarding(role ? tr(`onboarding.role.${role}`) : '') } catch (_) { /* ignore */ }
    onDone()
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <button className="onboarding-close" type="button" onClick={handleQuickExit} title={replay ? tr('onboarding.close_help') : tr('onboarding.exit_setup')}>
          <UiIcon name="x" />
        </button>
        <div className="onboarding-progress">
          {STEP_KEYS.map((key, i) => (
            <div key={key} className={`onboarding-step${i === step ? ' active' : i < step ? ' done' : ''}`}>
              <div className="onboarding-step-dot">{i < step ? <UiIcon name="check" /> : i + 1}</div>
              <span>{tr(`onboarding.step.${key}`)}</span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="onboarding-content">
            <div className="onboarding-hero">
              <span className="onboarding-logo">K</span>
              <span className="onboarding-kicker">{tr('onboarding.step_count', { current: 1, total: 4 })}</span>
              <h2>{replay ? tr('onboarding.replay_title') : tr('onboarding.welcome_title')}</h2>
              <p>{replay ? tr('onboarding.replay_intro') : tr('onboarding.welcome_intro')}</p>
            </div>
            <div className="onboarding-model">
              <div><b>{tr('onboarding.model.objective')}</b><span>{tr('onboarding.model.objective_desc')}</span></div>
              <div><b>KPI</b><span>{tr('onboarding.model.kpi_desc')}</span></div>
              <div><b>{tr('onboarding.model.work_item')}</b><span>{tr('onboarding.model.work_item_desc')}</span></div>
            </div>
            <label className="modal-field">
              {tr('onboarding.role_label')}
              <select value={role} onChange={e => setRole(e.target.value)}>
                <option value="">{tr('onboarding.role_placeholder')}</option>
                {ROLE_KEYS.map(key => <option key={key} value={key}>{tr(`onboarding.role.${key}`)}</option>)}
              </select>
            </label>
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={handleQuickExit} disabled={saving}>{replay ? tr('common.close') : tr('common.skip')}</button>
              <button className="btn primary" onClick={handleStep1}>{replay ? tr('onboarding.view_steps') : tr('onboarding.start')}</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-content">
            <span className="onboarding-kicker">{tr('onboarding.step_count', { current: 2, total: 4 })}</span>
            <h3>{tr('onboarding.cycle_title')}</h3>
            <p className="onboarding-hint">{replay ? tr('onboarding.cycle_hint_replay') : tr('onboarding.cycle_hint')}</p>
            <div className="onboarding-preset-row">
              <button className="btn small ghost" type="button" onClick={() => applyCyclePreset('year')}>{tr('onboarding.preset_this_year')}</button>
              <button className="btn small ghost" type="button" onClick={() => applyCyclePreset('next_year')}>{tr('onboarding.preset_next_year')}</button>
              <button className="btn small ghost" type="button" onClick={() => applyCyclePreset('quarter')}>{tr('onboarding.preset_current_quarter')}</button>
              <button className="btn small ghost" type="button" onClick={() => applyCyclePreset('month')}>{tr('onboarding.preset_current_month')}</button>
            </div>
            <label className="modal-field">
              {tr('onboarding.cycle_kind')}
              <select value={cycleKind} onChange={e => { setCycleKind(e.target.value); setError('') }}>
                <option value="yearly">{tr('onboarding.cycle_kind_year')}</option>
                <option value="quarterly">{tr('onboarding.cycle_kind_quarter')}</option>
                <option value="monthly">{tr('onboarding.cycle_kind_month')}</option>
                <option value="custom">{tr('onboarding.cycle_kind_custom')}</option>
              </select>
            </label>
            <label className="modal-field">
              {tr('onboarding.cycle_name')}
              <input value={cycleName} onChange={e => { setCycleName(e.target.value); setError('') }} placeholder={tr('onboarding.cycle_name_ph')} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label className="modal-field" style={{ flex: 1 }}>
                {tr('onboarding.start_date')}
                <input type="date" value={cycleStart} onChange={e => { setCycleStart(e.target.value); setError('') }} />
              </label>
              <label className="modal-field" style={{ flex: 1 }}>
                {tr('onboarding.end_date')}
                <input type="date" value={cycleEnd} onChange={e => { setCycleEnd(e.target.value); setError('') }} />
              </label>
            </div>
            {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={() => setStep(0)}>{tr('common.back')}</button>
              <button className="btn ghost" onClick={handleQuickExit} disabled={saving}>{replay ? tr('common.close') : tr('onboarding.quick_exit')}</button>
              <button className="btn primary" onClick={handleStep2} disabled={saving || !cycleName.trim()}>
                {replay ? tr('onboarding.continue_view') : saving ? tr('onboarding.creating') : tr('onboarding.create_cycle')}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-content">
            <span className="onboarding-kicker">{tr('onboarding.step_count', { current: 3, total: 4 })}</span>
            <h3>{tr('onboarding.first_kpi_title')}</h3>
            <p className="onboarding-hint">{replay ? tr('onboarding.first_kpi_hint_replay') : tr('onboarding.first_kpi_hint')}</p>

            <div className="onboarding-kpi-suggestions">
              <p>{tr('onboarding.suggestions_title')}</p>
              {suggestions.map(s => {
                const item = suggestionValue(s)
                return (
                  <button key={s.nameKey} className="onboarding-suggestion" type="button" onClick={() => applySuggestion(s)}>
                    <b>{item.name}</b>
                    <span>{item.targetValue} {item.unit}</span>
                  </button>
                )
              })}
            </div>

            <label className="modal-field">
              {tr('onboarding.objective_label')}
              <input value={objectiveName} onChange={e => setObjectiveName(e.target.value)} placeholder={tr('onboarding.objective_ph')} />
            </label>
            <label className="modal-field">
              {tr('onboarding.kpi_name')}
              <input value={kpiName} onChange={e => setKpiName(e.target.value)} placeholder={tr('onboarding.kpi_name_ph')} />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="modal-field" style={{ flex: '2 1 220px' }}>
                {tr('onboarding.target_desc')}
                <input value={kpiTarget} onChange={e => setKpiTarget(e.target.value)} placeholder={tr('onboarding.target_desc_ph')} />
              </label>
              <label className="modal-field" style={{ flex: '1 1 120px' }}>
                {tr('onboarding.unit')}
                <input value={kpiUnit} onChange={e => setKpiUnit(e.target.value)} placeholder={tr('onboarding.unit_ph')} />
              </label>
              <label className="modal-field" style={{ flex: '0 1 100px' }}>
                {tr('onboarding.target_number')}
                <NumberStepper min="0" step="any" value={kpiTargetValue} onChange={value => setKpiTargetValue(normalizeNonNegativeInput(value))} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="modal-field" style={{ flex: '1 1 120px' }}>
                {tr('onboarding.actual_current')}
                <NumberStepper min="0" step="any" value={kpiCurrentValue} onChange={value => setKpiCurrentValue(normalizeNonNegativeInput(value))} />
              </label>
              <label className="modal-field" style={{ flex: '1 1 120px' }}>
                {tr('onboarding.kpi_weight')}
                <NumberStepper min="0" max="100" step="1" value={kpiWeight} onChange={value => setKpiWeight(normalizeWeightInput(value))} />
              </label>
              <label className="modal-field" style={{ flex: '1 1 140px' }}>
                {tr('kpis.deadline_label')}
                <input type="date" value={kpiDeadline} onChange={e => setKpiDeadline(e.target.value)} />
              </label>
              <label className="modal-field" style={{ flex: '1 1 120px' }}>
                {tr('onboarding.kpi_type')}
                <select value={kpiCategory} onChange={e => setKpiCategory(e.target.value)}>
                  <option value="Work">{tr('category.work')}</option>
                  <option value="Personal">{tr('category.personal')}</option>
                </select>
              </label>
            </div>
            {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={() => { setError(''); setStep(1) }}>{tr('common.back')}</button>
              <button className="btn ghost" onClick={async () => {
                setKpiName(''); setSaving(true)
                try { if (!replay) await api.completeOnboarding(role ? tr(`onboarding.role.${role}`) : ''); setStep(3) }
                catch (_) { setStep(3) } finally { setSaving(false) }
              }}>{replay ? tr('onboarding.continue_view_plain') : tr('onboarding.skip_step')}</button>
              <button className="btn ghost" onClick={handleQuickExit} disabled={saving}>{replay ? tr('common.close') : tr('onboarding.quick_exit')}</button>
              <button className="btn primary" onClick={handleStep3} disabled={saving || !kpiName.trim()}>
                {replay ? tr('onboarding.view_done') : saving ? tr('onboarding.saving') : tr('onboarding.save_kpi')}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-content" style={{ textAlign: 'center' }}>
            <span className="onboarding-done-icon"><UiIcon name="check" /></span>
            <span className="onboarding-kicker">{tr('onboarding.step_count', { current: 4, total: 4 })}</span>
            <h2>{replay ? tr('onboarding.done_replay_title') : tr('onboarding.done_title')}</h2>
            <p>{replay ? tr('onboarding.done_replay_text') : tr('onboarding.done_text')}</p>
            <div className="onboarding-actions" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={handleFinish}>{replay ? tr('onboarding.close_help') : tr('onboarding.go_dashboard')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
