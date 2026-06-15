import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'
import { useView, matchView } from '../ViewContext'
import { useCycle } from '../CycleContext'
import ViewModeSwitch from '../components/ViewModeSwitch'
import { ConfirmModal, Modal, PromptModal } from '../components/Modal'
import { useToast } from '../components/Toast'

const EMPTY = {
  name: '', description: '', target: '', weight: 10, year: 2026, deadline: '',
  objective_id: '', unit: '%', target_value: 100, category: 'Work',
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
    <div className="modal-overlay">
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
    category: kpi.category || 'Work',
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
  // server xac nhan lai tong moi nhat (400ms debounce) — uu tien khi co du lieu
  const displayTotal = serverTotal ?? groupTotal
  const over = displayTotal !== null && displayTotal > 100

  useEffect(() => {
    if (!wValid) { setServerTotal(null); return }
    clearTimeout(svTimerRef.current)
    svTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.validateKpiWeights(targetObjId, w, kpi.id)
        setServerTotal(res.projected_total)
      } catch { setServerTotal(null) }
    }, 400)
    return () => clearTimeout(svTimerRef.current)
  }, [w, targetObjId, wValid])
  const groupName = targetObjId
    ? objectives.find((o) => o.id === targetObjId)?.name
    : tr('kpis.ungrouped_plain')

  const changed =
    f.name !== kpi.name || f.description !== (kpi.description || '') ||
    f.target !== (kpi.target || '') || (wValid && w !== kpi.weight) ||
    f.deadline !== (kpi.deadline || '') || f.unit !== (kpi.unit || '%') ||
    (tvValid && tv !== kpi.target_value) || (cvValid && cv !== kpi.current_value) ||
    String(f.objective_id) !== String(kpi.objective_id ?? '') ||
    f.category !== (kpi.category || 'Work')
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
        <label className="modal-field">{tr('kpim.category')}
          <select value={f.category} onChange={(e) => set('category', e.target.value)}>
            <option value="Work">{tr('category.work')}</option>
            <option value="Personal">{tr('category.personal')}</option>
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
          <WeightHint total={displayTotal} label={tr('wh.kpi_group', { name: groupName })} tr={tr} />
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

function SmartPanel({ result, tr }) {
  const scoreClass = (v) => v === 2 ? 'smart-ok' : v === 1 ? 'smart-partial' : 'smart-fail'
  const scoreIcon = (v) => v === 2 ? '✓' : v === 1 ? '~' : '✗'
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
          {result.valid ? tr('kpis.smart_pass') : tr('kpis.smart_fail')}
        </span>
      </div>
      {result.issues?.length > 0 && (
        <div className="smart-section">
          <b>⚠️ {tr('kpis.smart_issues')}</b>
          <ul>{result.issues.map((iss, i) => <li key={i}>{iss}</li>)}</ul>
        </div>
      )}
      {result.suggestions?.length > 0 && (
        <div className="smart-section">
          <b>💡 {tr('kpis.smart_suggestions')}</b>
          <ul>{result.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

function KpiCockpit({ objectives, visibleKpis, conflicts, totalObjWeight, onShowConflicts, onAddKpi, onImport, tr }) {
  const weightedProgress = objectives.length
    ? Math.round(objectives.reduce((s, o) => s + ((o.progress || 0) * (o.weight || 0) / 100), 0) * 10) / 10
    : Math.round((visibleKpis.reduce((s, k) => s + (k.progress || 0), 0) / Math.max(visibleKpis.length, 1)) * 10) / 10
  const riskKpis = visibleKpis.filter((k) => (k.progress || 0) < 50)
  const overKpis = visibleKpis.filter((k) => (k.progress || 0) > 100)
  const weightGap = Math.round((100 - totalObjWeight) * 10) / 10
  const bestNext = conflicts.length
    ? `Gỡ ${conflicts.length} xung đột trọng số trước khi thêm KPI mới.`
    : totalObjWeight !== 100
      ? `${weightGap > 0 ? 'Còn' : 'Vượt'} ${Math.abs(weightGap)}% trọng số mục tiêu cần cân lại.`
      : riskKpis.length
        ? `Ưu tiên ${riskKpis.length} KPI đang cần chú ý trong chế độ Tập trung.`
        : 'Khung KPI đang gọn. Bước tiếp theo là cập nhật tiến độ định kỳ.'

  return (
    <section className="kpi-cockpit" aria-label="KPI cockpit">
      <div className="cockpit-hero">
        <span className="cockpit-kicker">Bức tranh 10 giây</span>
        <h2>{weightedProgress}%</h2>
        <p>Tiến độ có trọng số trong chu kỳ hiện tại</p>
        <div className="cockpit-orbit" aria-hidden="true">
          <span style={{ '--v': `${Math.min(100, weightedProgress)}%` }} />
        </div>
      </div>
      <div className="cockpit-grid">
        <div className="cockpit-metric">
          <span>Tổng KPI</span>
          <b>{visibleKpis.length}</b>
          <small>{objectives.length} mục tiêu</small>
        </div>
        <button className={`cockpit-metric clickable ${conflicts.length ? 'danger' : 'ok'}`} onClick={onShowConflicts}>
          <span>Xung đột</span>
          <b>{conflicts.length}</b>
          <small>{conflicts.length ? 'Cần xử lý' : 'Ổn'}</small>
        </button>
        <div className={`cockpit-metric ${totalObjWeight === 100 ? 'ok' : totalObjWeight > 100 ? 'danger' : 'warn'}`}>
          <span>Trọng số mục tiêu</span>
          <b>{totalObjWeight}%</b>
          <small>{totalObjWeight === 100 ? 'Đủ 100%' : `${Math.abs(weightGap)}% ${weightGap > 0 ? 'còn trống' : 'vượt'}`}</small>
        </div>
        <div className="cockpit-metric">
          <span>Vượt chỉ tiêu</span>
          <b>{overKpis.length}</b>
          <small>điểm sáng</small>
        </div>
      </div>
      <div className="cockpit-next">
        <div>
          <span className="cockpit-kicker">Gợi ý tiếp theo</span>
          <strong>{bestNext}</strong>
        </div>
        <div className="cockpit-next-actions">
          <button className="btn ghost" onClick={onImport}>{tr('kpis.btn_import')}</button>
          <button className="btn primary" onClick={onAddKpi}>{tr('kpis.btn_add')}</button>
        </div>
      </div>
    </section>
  )
}

function KpiCard({ kpi, busyId, expanded, changelog, smartResult, smartLoadingId, actions, inConflict, tr }) {
  // dich ten truong/gia tri trong lich su thay doi sang tieng nguoi dung (khong lo ten field tho)
  const fieldLabel = (f) => { const k = `field.${f}`; const t = tr(k); return t === k ? f : t }
  const fieldValue = (f, v) => {
    if (f === 'archived') return tr(`fieldval.archived.${String(v).toLowerCase() === 'true'}`)
    return v
  }
  const over = kpi.progress > 100
  const statusClass = over ? 'over' : kpi.progress >= 70 ? 'good' : kpi.progress >= 40 ? 'watch' : 'risk'
  const statusLabel = over ? 'Vượt mục tiêu' : kpi.progress >= 70 ? 'Đang tốt' : kpi.progress >= 40 ? 'Cần theo dõi' : 'Ưu tiên xử lý'
  const measure = kpi.unit === '%'
    ? <>{tr('kpis.actual')} <b>{kpi.current_value}%</b></>
    : <>{tr('kpis.actual')} <b>{kpi.current_value}/{kpi.target_value} {kpi.unit}</b> ({kpi.progress}%)</>
  return (
    <div className={`card kpi-row status-${statusClass}${inConflict ? ' in-conflict' : ''}`}>
      <div className="kpi-card-grid">
        <div className="kpi-main">
          <div className="kpi-title-line">
            <strong>{kpi.name}</strong>
            <span className={`cat-badge ${kpi.category === 'Personal' ? 'personal' : 'work'}`}>
              {kpi.category === 'Personal' ? tr('category.personal') : tr('category.work')}
            </span>
            {over && <span className="over-badge">{tr('kpis.over_badge')}</span>}
            {inConflict && <span className="conflict-tag">{tr('kpis.conflict_tag')}</span>}
          </div>
          <div className="kpi-meta">
            {kpi.target && <span className="meta-seg">{kpi.target}</span>}
            <span className="meta-seg">{measure}</span>
            <span className="meta-seg">{tr('kpis.meta_weight', { weight: kpi.weight })}</span>
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
          <button
            className={`icon-btn ${smartResult ? 'on' : ''} ${smartLoadingId === kpi.id ? 'spinning' : ''}`}
            disabled={smartLoadingId === kpi.id}
            title={smartLoadingId === kpi.id ? tr('kpis.smart_loading') : tr('kpis.tip_smart')}
            onClick={() => actions.smartCheck(kpi.id)}
          >🎯</button>
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
function ImportWizard({ preview, objectives, kpis, cycleId, onClose, onSaved, tr }) {
  const [step, setStep] = useState('preview') // 'preview' | 'assign' | 'confirm'
  const [weights, setWeights] = useState({})
  const [initialWeights, setInitialWeights] = useState({}) // để track thay đổi
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const objKey = (name) => `obj::${name}`
  const kpiKey = (oName, kName) => `kpi::${oName}::${kName}`

  const errors = preview.messages.filter((m) => m.level === 'error')
  const hasHardErrors = errors.length > 0
  const importedObjWeight = Math.round(preview.objectives
    .filter((o) => o.is_new)
    .reduce((s, o) => s + (o.weight || 0), 0) * 10) / 10
  const projectedObjWeight = Math.round((preview.existing_obj_total + importedObjWeight) * 10) / 10
  const totalImportKpis = preview.objectives.reduce((s, o) => s + (o.kpis?.length || 0), 0)

  // Kiểm tra có thay đổi so với ban đầu không
  const hasChanges = Object.keys(weights).some((key) => weights[key] !== initialWeights[key])

  // Xử lý đóng — có xác nhận nếu có thay đổi
  const handleClose = () => {
    if (hasChanges) {
      setShowCloseConfirm(true)
    } else {
      onClose()
    }
  }

  // Pre-populate tat ca weight fields khi chuyen sang buoc 2
  const enterAssignStep = () => {
    const initial = {}
    preview.objectives.forEach((o) => {
      if (o.is_new) initial[objKey(o.name)] = o.weight > 0 ? String(o.weight) : ''
      o.kpis.forEach((k) => { initial[kpiKey(o.name, k.name)] = k.has_weight ? String(k.weight) : '' })
    })
    setWeights(initial)
    setInitialWeights(initial) // lưu lại giá trị ban đầu để so sánh
    setStep('assign')
  }

  // Xay dung KPIProposalConfirm payload tu preview data + user weights
  const buildProposal = () => {
    const newObjectives = preview.objectives
      .filter((o) => o.is_new)
      .map((o) => ({
        name: o.name,
        description: '',
        weight: parseFloat(weights[objKey(o.name)]) || o.weight || 0,
      }))
    const allKpis = preview.objectives.flatMap((o) =>
      o.kpis.map((k) => ({
        name: k.name,
        description: k.note || '',
        target: '',
        unit: '%',
        target_value: 100.0,
        weight: parseFloat(weights[kpiKey(o.name, k.name)]) || k.weight || 0,
        objective_id: o.is_new ? null : o.objective_id,
        objective_ref: o.is_new ? o.name : null,
        category: 'Work',
      }))
    )
    return { objectives: newObjectives, kpis: allKpis, weight_changes: [], cycle_id: cycleId ?? null }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await api.confirmKpiProposal(buildProposal())
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
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

    const effectiveNewObjTotal = preview.objectives
      .filter((o) => o.is_new)
      .reduce((s, o) => s + getW(objKey(o.name), o.weight || 0), 0)
    const effectiveObjTotal = preview.existing_obj_total + effectiveNewObjTotal

    const getKpiTotal = (o) =>
      o.existing_kpi_total + o.kpis.reduce((s, k) => s + getW(kpiKey(o.name, k.name), k.weight || 0), 0)

    const clientErrors = []
    if (effectiveObjTotal > 100.001)
      clientErrors.push(`Tổng trọng số mục tiêu = ${effectiveObjTotal.toFixed(1)}% — vượt 100%`)
    preview.objectives.forEach((o) => {
      const t = getKpiTotal(o)
      if (t > 100.001)
        clientErrors.push(`"${o.name}": tổng KPI = ${t.toFixed(1)}% — vượt 100%`)
    })
    const canSaveNow = clientErrors.length === 0

    const newObjs = preview.objectives.filter((o) => o.is_new)

    return (
      <div className="modal-overlay">
        <div className="modal modal-wide import-wizard" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={handleClose} title={tr('kpim.cancel')}>×</button>
          <div className="wizard-steps">
            <span className="step done">{tr('import.wizard.step_preview')}</span>
            <span className="step active">{tr('import.wizard.step_assign')}</span>
            <span className="step">{tr('import.wizard.step_confirm')}</span>
          </div>
          <h3>📊 {tr('import.wizard.assign_title')}</h3>

          <div className={`assign-summary ${effectiveObjTotal > 100.001 ? 'danger' : 'ok'}`}>
            <div>
              <span>Mục tiêu hiện có</span>
              <b>{preview.existing_obj_total}%</b>
            </div>
            <div>
              <span>Sau điều chỉnh</span>
              <b>{Math.round(effectiveObjTotal * 10) / 10}%</b>
            </div>
            <div>
              <span>Còn có thể phân bổ</span>
              <b>{Math.max(0, Math.round((100 - preview.existing_obj_total) * 10) / 10)}%</b>
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

          {/* Phan A: trong so muc tieu moi */}
          {newObjs.length > 0 && (
            <div className={`assign-section${effectiveObjTotal > 100.001 ? ' has-error' : ''}`}>
              <h4>{tr('import.wizard.new_obj_section')}</h4>
              {newObjs.map((o) => (
                <div key={o.name} className="weight-input-row">
                  <span className="weight-label">{o.name}</span>
                  <input
                    type="number" min="0" max="100" step="1"
                    value={weights[objKey(o.name)] ?? ''}
                    onChange={(e) => setWeights((w) => ({ ...w, [objKey(o.name)]: e.target.value }))}
                    style={{ width: 80 }}
                  />
                  <span>%</span>
                </div>
              ))}
              <button className="btn small ghost" onClick={() => {
                const remaining = Math.max(0, 100 - preview.existing_obj_total)
                const each = newObjs.length > 0 ? Math.floor(remaining / newObjs.length) : 0
                const upd = {}
                newObjs.forEach((o) => { upd[objKey(o.name)] = String(each) })
                setWeights((w) => ({ ...w, ...upd }))
              }}>{tr('import.wizard.even_split')}</button>
              <WeightHint total={effectiveObjTotal} label={tr('wh.obj_total')} tr={tr} />
            </div>
          )}

          {/* Phan B: tat ca KPI cua tung muc tieu (ke ca co san trong so) */}
          {preview.objectives.map((o) => {
            if (o.kpis.length === 0) return null
            const kpiTotal = getKpiTotal(o)
            const hasKpiError = kpiTotal > 100.001
            return (
              <div key={o.name} className={`assign-section${hasKpiError ? ' has-error' : ''}`}>
                <h4>{tr('import.wizard.kpi_section', { name: o.name })}</h4>
                {o.existing_kpi_total > 0 && (
                  <p className="muted">{tr('import.wizard.obj_existing_total', { pct: o.existing_kpi_total.toFixed(0) })}</p>
                )}
                {o.kpis.map((k) => (
                  <div key={k.name} className="weight-input-row">
                    <span className="weight-label">{k.name}</span>
                    <input
                      type="number" min="0" max="100" step="1"
                      value={weights[kpiKey(o.name, k.name)] ?? ''}
                      onChange={(e) => setWeights((w) => ({ ...w, [kpiKey(o.name, k.name)]: e.target.value }))}
                      style={{ width: 80 }}
                    />
                    <span>%</span>
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

          {error && <div className="error-text">⚠️ {error}</div>}
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
    const newObjs = preview.objectives.filter((o) => o.is_new)
    const effectiveNewObjTotal = newObjs.reduce((s, o) => s + getW(objKey(o.name), o.weight || 0), 0)
    const effectiveObjTotal = preview.existing_obj_total + effectiveNewObjTotal
    const totalKpis = preview.objectives.reduce((s, o) => s + o.kpis.length, 0)

    return (
      <div className="modal-overlay">
        <div className="modal modal-wide import-wizard" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={handleClose} title={tr('kpim.cancel')}>×</button>
          <div className="wizard-steps">
            <span className="step done">{tr('import.wizard.step_preview')}</span>
            <span className="step done">{tr('import.wizard.step_assign')}</span>
            <span className="step active">{tr('import.wizard.step_confirm')}</span>
          </div>
          <h3>✅ {tr('import.wizard.confirm_title')}</h3>

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

          {preview.objectives.filter((o) => !o.is_new && o.kpis.length > 0).map((o) => (
            <div key={o.name} className="assign-section">
              <div className="weight-input-row">
                <span className="weight-label">{o.name}</span>
                <span className="muted">{tr('import.wizard.tag_existing')} — {o.kpis.length} KPI</span>
              </div>
            </div>
          ))}

          {error && <div className="error-text">⚠️ {error}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setStep('assign')}>{tr('import.wizard.back')}</button>
            <button className="btn primary" disabled={saving} onClick={handleSave}>
              {saving ? tr('import.wizard.saving') : tr('import.wizard.save_btn')}
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
        <button className="modal-close-btn" onClick={handleClose} title={tr('kpim.cancel')}>×</button>
        <div className="wizard-steps">
          <span className="step active">{tr('import.wizard.step_preview')}</span>
          <span className="step">{tr('import.wizard.step_assign')}</span>
          <span className="step">{tr('import.wizard.step_confirm')}</span>
        </div>
        <h3>📂 {tr('import.wizard.preview_title')}</h3>

        <div className={`import-decision-card ${hasHardErrors ? 'danger' : preview.needs_weight_input ? 'warn' : 'ok'}`}>
          <div>
            <span>Hiện có</span>
            <b>{preview.existing_obj_total}%</b>
          </div>
          <div>
            <span>File thêm</span>
            <b>{importedObjWeight}%</b>
          </div>
          <div>
            <span>Sau import</span>
            <b>{projectedObjWeight}%</b>
          </div>
          <strong>
            {hasHardErrors
              ? 'Cần gán lại trọng số trước khi lưu.'
              : preview.needs_weight_input
                ? 'Cần bổ sung trọng số còn thiếu.'
                : 'Có thể lưu ngay.'}
          </strong>
        </div>

        <details className="import-details">
          <summary>Xem {preview.objectives.length} mục tiêu và {totalImportKpis} KPI trong file</summary>
        <div className="import-obj-list">
          {preview.objectives.map((o) => (
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
          <button className="btn ghost" onClick={handleClose}>{tr('kpim.cancel')}</button>
          {/* Neu co loi cung hoac can nhap trong so → cho phep sang buoc 2 de sua truc tiep */}
          {(hasHardErrors || preview.needs_weight_input) && (
            <button className="btn primary" onClick={enterAssignStep}>
              {hasHardErrors
                ? tr('import.wizard.fix_weights_btn')
                : tr('import.wizard.assign_weights_btn')}
            </button>
          )}
          {/* Khong co loi, khong can nhap → luu thang */}
          {preview.can_save && !preview.needs_weight_input && (
            <button className="btn primary" disabled={saving} onClick={handleSave}>
              {saving ? tr('import.wizard.saving') : tr('import.wizard.save_btn')}
            </button>
          )}
        </div>
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

let _conflictCacheKpiIds = null
let _conflictCacheResult = null

export default function Kpis() {
  const { tr } = useLang()
  const { mode } = useView()
  const toast = useToast()
  const { activeCycleId, activeCycle, cycles, fetchCycles, currentYear } = useCycle()
  const [kpis, setKpis] = useState([])
  const [objectives, setObjectives] = useState([])
  const [form, setForm] = useState({ ...EMPTY, year: currentYear })
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [changelog, setChangelog] = useState({})
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [objModal, setObjModal] = useState(null) // null | {} (tao moi) | objective
  const [conflicts, setConflicts] = useState(null) // null = chưa phân tích
  const [analyzing, setAnalyzing] = useState(false)
  const [conflictsHidden, setConflictsHidden] = useState(true) // thu gọn nội dung panel
  const [conflictsClosed, setConflictsClosed] = useState(false) // đóng hẳn panel (vẫn mở lại được)
  const fileRef = useRef(null)
  const formAnchorRef = useRef(null)
  const [importAnalyzing, setImportAnalyzing] = useState(false)
  const [importSuggestion, setImportSuggestion] = useState(null) // full ChatResponse object
  const [confirmingProposal, setConfirmingProposal] = useState(false)
  const [importConflict, setImportConflict] = useState(null)
  const [pendingImportFile, setPendingImportFile] = useState(null)
  const [importWizard, setImportWizard] = useState(null) // { preview } | null
  const [removeObjConfirm, setRemoveObjConfirm] = useState(null)
  const [archivePrompt, setArchivePrompt] = useState(null)
  const [balancePending, setBalancePending] = useState(null)

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
    setCloneForm({ name: `Năm ${nextYear}`, start_date: `${nextYear}-01-01`, end_date: `${nextYear}-12-31` })
    setCloneExcludes([])
    setCloneError('')
    setShowCloneModal(true)
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
      toast.success(`Đã clone thành công chu kỳ "${cloneForm.name}"`)
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
      toast.success('Đã copy link chia sẻ')
      setTimeout(() => setShareCopied(''), 2000)
    })
  }
  const [smartResults, setSmartResults] = useState({}) // { [kpiId]: result | null }
  const [smartLoadingId, setSmartLoadingId] = useState(null)
  const [groupPage, setGroupPage] = useState({}) // { [objId]: currentPage }
  const ITEMS_PER_PAGE = 10 // số KPI trên mỗi trang

  // Pagination helpers
  const getGroupPage = (objId) => groupPage[objId ?? 'none'] || 1
  const setGroupPageNum = (objId, page) => setGroupPage((p) => ({ ...p, [objId ?? 'none']: page }))
  const paginate = (arr, objId) => {
    const page = getGroupPage(objId)
    const start = (page - 1) * ITEMS_PER_PAGE
    return { items: arr.slice(start, start + ITEMS_PER_PAGE), page, totalPages: Math.ceil(arr.length / ITEMS_PER_PAGE) }
  }

  const load = () =>
    Promise.all([api.listKpis(activeCycleId), api.listObjectives(activeCycleId)])
      .then(([k, o]) => {
        setKpis(k); setObjectives(o)
        if (k.length >= 2) {
          const kpiIds = k.map((kpi) => kpi.id).sort().join(',')
          if (_conflictCacheKpiIds === kpiIds && _conflictCacheResult !== null) {
            setConflicts(_conflictCacheResult)
            if (_conflictCacheResult.length) { setConflictsHidden(true); setConflictsClosed(false) }
          } else if (_conflictCacheKpiIds !== kpiIds) {
            _conflictCacheKpiIds = kpiIds
            analyzeConflicts()
          }
        }
      })
      .catch((e) => setError(e.message))
  useEffect(() => { load() }, [activeCycleId])  // eslint-disable-line react-hooks/exhaustive-deps

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
    const kpiList = unassigned.map(k => `- ${k.name}${k.description ? ` (${k.description})` : ''}`).join('\n')
    const objNames = objectives.map(o => o.name).join(', ') || 'chưa có'
    const msg = (
      `[TỰ ĐỘNG PHÂN BỔ - KHÔNG HỎI LẠI]\n` +
      `${unassigned.length} KPI vừa import chưa có mục tiêu:\n${kpiList}\n\n` +
      `Mục tiêu hiện có: ${objNames}.\n\n` +
      `Yêu cầu: Trả lời bằng danh sách phân bổ rõ ràng, mỗi KPI → mục tiêu phù hợp nhất ` +
      `(hoặc "Tạo mới: [tên mục tiêu]" nếu chưa có). Không hỏi lại, không giải thích dài.`
    )
    try {
      const res = await api.sendChat(msg)
      setImportSuggestion(res || null)
    } catch { /* non-blocking */ } finally { setImportAnalyzing(false) }
  }

  const importFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      // Thu preview (chi ho tro dinh dang Performance Appraisal)
      const preview = await api.previewImport(file)
      setImportWizard({ preview })
    } catch (previewErr) {
      // not_appraisal: fallback sang luong import cu (flat file)
      if (previewErr._type === 'not_appraisal') {
        try {
          const result = await api.importKpis(file)
          if (result._conflict) {
            setPendingImportFile(file)
            setImportConflict(result)
            return
          }
          await _afterImportSuccess(result)
        } catch (err) { setError(err.message) }
      } else {
        setError(previewErr.message)
      }
    }
  }

  const handleImportConflictChoice = async (choice) => {
    const file = pendingImportFile
    setImportConflict(null)
    setPendingImportFile(null)
    try {
      const created = await api.importKpis(file, choice)
      await _afterImportSuccess(created, choice) // truyen mode de agent_map goi endpoint rieng
    } catch (err) { setError(err.message) }
  }

  const confirmImportProposal = async () => {
    if (!importSuggestion) return
    setConfirmingProposal(true)
    try {
      await api.confirmKpiProposal({
        objectives: importSuggestion.proposed_objectives || [],
        kpis: importSuggestion.proposed_kpis || [],
        weight_changes: importSuggestion.weight_changes || [],
      })
      toast.success(tr('kpis.import_agent_confirm_success'))
      setImportSuggestion(null)
      load()
    } catch (err) { setError(err.message) } finally { setConfirmingProposal(false) }
  }

  const openFormForGroup = (objId) => {
    setForm({ ...EMPTY, objective_id: objId ? String(objId) : '' })
    setShowForm(true)
    setTimeout(() => formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const analyzeConflicts = async () => {
    setAnalyzing(true)
    try {
      const res = await api.analyzeConflicts()
      _conflictCacheResult = res.conflicts
      setConflicts(res.conflicts)
      if (res.conflicts.length) { setConflictsHidden(true); setConflictsClosed(false) }
    } catch {
      _conflictCacheKpiIds = null // allow retry next visit
    } finally { setAnalyzing(false) }
  }

  const conflictKpiIds = new Set((conflicts || []).flatMap((c) => c.kpi_ids))

  const removeObjective = (o) => setRemoveObjConfirm(o)
  const doRemoveObjective = async () => {
    if (!removeObjConfirm) return
    await api.deleteObjective(removeObjConfirm.id)
    setRemoveObjConfirm(null)
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
    archive: (kpi) => setArchivePrompt(kpi),
    edit: (kpi) => setEditing(kpi),
    toggleExpand: (id) => setExpanded(expanded === id ? null : id),
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
    await api.deleteKpi(archivePrompt.id, reason)
    setArchivePrompt(null)
    load()
  }

  const doBalance = async () => {
    if (!balancePending) return
    try {
      await api.balanceWeights(balancePending.objId)
      load()
    } catch (e) { setError(e.message) } finally { setBalancePending(null) }
  }

  // loc theo che do hien thi toan cuc (Work/Personal); focus & all hien tat ca tren trang nay
  const visibleKpis = kpis.filter((k) => matchView(mode, k.category))
  const groups = [
    ...objectives.map((o) => ({ obj: o, kpis: visibleKpis.filter((k) => k.objective_id === o.id) })),
    { obj: null, kpis: visibleKpis.filter((k) => !k.objective_id) },
  ].filter((g) => g.kpis.length > 0 || (mode === 'all' && g.obj))

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>{tr('kpis.title')}</h1>
          <p>{tr('kpis.subtitle')}</p>
        </div>
        <div className="header-actions">
          {analyzing && <span className="muted conflict-scanning">{tr('kpis.conflict_analyzing')}</span>}
          {!analyzing && conflictsClosed && conflicts?.length > 0 && (
            <button className="btn" onClick={() => { setConflictsClosed(false); setConflictsHidden(false) }}>
              {tr('kpis.conflict_reopen', { count: conflicts.length })}
            </button>
          )}
          <button className="btn" title={tr('kpis.btn_export_appraisal_tip')}
            onClick={() => api.exportAppraisal().catch((e) => setError(e.message))}>
            {tr('kpis.btn_export_appraisal')}
          </button>
          <button className="btn" onClick={() => api.exportEvaluation().catch((e) => setError(e.message))}>
            {tr('kpis.btn_export')}
          </button>
          <button className="btn" onClick={openShareModal} disabled={!activeCycleId} title="Tạo link xem tổng quan KPI không cần đăng nhập">
            Chia sẻ tổng quan
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={importFile} />
          {activeCycleId && (
            <button className="btn" title="Nhân bản chu kỳ này sang chu kỳ mới" onClick={openCloneModal}>
              Clone chu kỳ
            </button>
          )}
          <button className="btn" onClick={() => setObjModal({})}>{tr('kpis.btn_add_obj')}</button>
        </div>
      </header>

      <ViewModeSwitch />

      <KpiCockpit
        objectives={objectives}
        visibleKpis={visibleKpis}
        conflicts={conflicts || []}
        totalObjWeight={totalObjWeight}
        tr={tr}
        onShowConflicts={() => { setConflictsClosed(false); setConflictsHidden(false) }}
        onAddKpi={() => setShowForm((v) => !v)}
        onImport={() => fileRef.current?.click()}
      />

      {error && <div className="error-text">⚠️ {error}</div>}

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
          <h3>⚠️ {tr('kpis.import_conflict_title')}</h3>
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
              <span>{conflicts[0]?.suggestion || 'Có KPI đang cạnh tranh cùng trọng số hoặc nguồn lực.'}</span>
            </div>
          )}
          {!conflictsHidden && conflicts.map((c, i) => (
            <div key={i} className={`conflict-item sev-${c.severity}`}>
              <div className="conflict-head">
                <span className={`sev-badge sev-${c.severity}`}>
                  {tr(`kpis.conflict_sev_${c.severity}`)}
                </span>
                <strong>{c.kpi_names.join(' ↔ ')}</strong>
              </div>
              <p><b>{tr('kpis.conflict_why')}</b> {c.explanation}</p>
              {c.suggestion && <p className="conflict-suggestion">💡 <b>{tr('kpis.conflict_suggestion')}</b> {c.suggestion}</p>}
            </div>
          ))}
        </div>
      )}

      {(importAnalyzing || importSuggestion) && (
        <div className="card import-suggestion-panel">
          <div className="row">
            <h3>🤖 {tr('kpis.import_agent_result')}</h3>
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
                      {confirmingProposal ? '…' : tr('kpis.import_agent_confirm')}
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
            <label>{tr('kpis.form_category')}
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="Work">{tr('category.work')}</option>
                <option value="Personal">{tr('category.personal')}</option>
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

      <Modal
        open={showShareModal}
        title="Chia sẻ tổng quan KPI"
        onClose={() => setShowShareModal(false)}
        actions={<button className="btn" onClick={() => setShowShareModal(false)}>Đóng</button>}
      >
        <div className="share-modal-intro">
          <div className="share-modal-icon" aria-hidden="true">↗</div>
          <div>
            <b>Read-only link</b>
            <p>Người nhận xem được tổng quan chu kỳ, Objective và KPI mà không cần đăng nhập; không có quyền chỉnh sửa.</p>
          </div>
        </div>
        <div className="share-create-row">
          <label>Hết hạn sau</label>
          <select value={shareExpireDays} onChange={e => setShareExpireDays(Number(e.target.value))}
            className="share-expiry-select">
            {[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{d} ngày</option>)}
          </select>
          <button className="btn primary small" onClick={createShareLink} disabled={shareBusy || !activeCycleId}>
            {shareBusy ? 'Đang tạo...' : 'Tạo link'}
          </button>
        </div>
        {!activeCycleId && <p style={{ color: '#ca8a04', fontSize: 13 }}>Chọn chu kỳ ở thanh trên để tạo link chia sẻ.</p>}
        {shareLinks.length === 0
          ? <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Chưa có link nào.</p>
          : shareLinks.map(link => {
            const url = `${window.location.origin}/shared/${link.token}`
            const expired = new Date(link.expires_at) < new Date()
            const revoked = !!link.revoked_at
            const invalid = expired || revoked
            const state = revoked ? 'Đã hủy' : expired ? 'Hết hạn' : 'Đang hoạt động'
            return (
              <div key={link.token} className={`share-link-item${invalid ? ' invalid' : ''}`}>
                <div className="share-link-main">
                  <div className="share-link-head">
                    <span className={`share-link-state${invalid ? ' invalid' : ''}`}>{state}</span>
                    <span className="share-link-meta">Hết hạn {new Date(link.expires_at).toLocaleDateString('vi-VN')}</span>
                  </div>
                  <div className={`share-link-url${invalid ? ' share-link-revoked' : ''}`}>{url}</div>
                  <div className="share-link-meta">
                    {revoked && ' · Đã hủy'}{expired && !revoked && ' · Hết hạn'}
                  </div>
                </div>
                <div className="share-link-actions">
                  {!invalid && (
                    <button className="btn small" onClick={() => copyShareLink(link.token)}>
                      {shareCopied === link.token ? '✓ Đã copy' : 'Copy'}
                    </button>
                  )}
                  {!revoked && (
                    <button className="btn small" style={{ color: '#dc2626' }} onClick={() => revokeShareLink(link.token)}>
                      Hủy
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
        const balance = () => setBalancePending({ objId: obj?.id ?? null, count: groupKpis.length })
        const objId = obj?.id ?? 'none'
        const { items: paginatedKpis, page, totalPages } = paginate(groupKpis, objId)
        const needsPagination = groupKpis.length > ITEMS_PER_PAGE

        return (
          <section className="objective-group" key={objId}>
            <div className="objective-head">
              <div className="objective-title">
                <h2>{obj ? obj.name : tr('kpis.ungrouped')}</h2>
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
              <>
                {paginatedKpis.map((kpi) => (
                  <KpiCard key={kpi.id} kpi={kpi} busyId={busyId} expanded={expanded} tr={tr}
                    changelog={changelog} smartResult={smartResults[kpi.id] ?? null}
                    smartLoadingId={smartLoadingId}
                    actions={actions} inConflict={conflictKpiIds.has(kpi.id)} />
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
            <h3>Clone chu kỳ</h3>
            <div className="clone-summary">
              <div>
                <span className="clone-summary-label">Nguồn</span>
                <b>{activeCycle?.name}</b>
              </div>
              <div>
                <span className="clone-summary-label">Sao chép</span>
                <b>{objectives.reduce((sum, obj) => sum + (obj.kpi_count || 0), 0)} KPI</b>
              </div>
              {activeCycle?.is_locked && (
                <span className="clone-locked-badge">Đã chốt</span>
              )}
            </div>
            <div className="clone-rules">
              <div><b>Giữ nguyên</b><span>Tên KPI, trọng số, đơn vị, target</span></div>
              <div><b>Reset</b><span>Actual value, ghi chú, tiến độ</span></div>
            </div>
            <label className="modal-field">Tên chu kỳ mới
              <input autoFocus value={cloneForm.name} onChange={e => setCloneForm({ ...cloneForm, name: e.target.value })} />
            </label>
            <div className="clone-date-row">
              <label className="modal-field">Ngày bắt đầu
                <input type="date" value={cloneForm.start_date} onChange={e => setCloneForm({ ...cloneForm, start_date: e.target.value })} />
              </label>
              <label className="modal-field">Ngày kết thúc
                <input type="date" value={cloneForm.end_date} onChange={e => setCloneForm({ ...cloneForm, end_date: e.target.value })} />
              </label>
            </div>
            {objectives.length > 0 && (
              <div className="clone-objective-box">
                <label>Chọn mục tiêu sẽ mang sang</label>
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
            {cloneError && <div className="error-text">⚠️ {cloneError}</div>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowCloneModal(false)}>Hủy</button>
              <button className="btn primary" disabled={cloneBusy || !cloneForm.name.trim()} onClick={doClone}>
                {cloneBusy ? 'Đang tạo...' : 'Tạo chu kỳ mới'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
