import { useState } from 'react'
import { api } from '../api'

const ROLES = [
  'Kỹ sư phần mềm',
  'Quản lý dự án',
  'Nhân viên kinh doanh',
  'Kế toán / Tài chính',
  'Marketing',
  'Vận hành / Operations',
  'Lãnh đạo / Manager',
  'Khác',
]

const STEP_LABELS = [
  'Chào mừng',
  'Tạo chu kỳ',
  'KPI đầu tiên',
  'Hoàn tất',
]

const ROLE_SUGGESTIONS = {
  'Kỹ sư phần mềm': [
    { name: 'Hoàn thành 90% sprint commitments', target: 'Đạt cam kết sprint đúng hạn', unit: '%', targetValue: 90 },
    { name: 'Giảm backlog bug nghiêm trọng', target: 'Xử lý bug P1/P2 trong SLA', unit: 'bug', targetValue: 12 },
  ],
  'Quản lý dự án': [
    { name: 'Dự án đạt mốc đúng hạn', target: 'Milestone hoàn thành theo kế hoạch', unit: '%', targetValue: 95 },
    { name: 'Cập nhật stakeholder hàng tuần', target: 'Báo cáo tiến độ đều đặn', unit: 'báo cáo', targetValue: 12 },
  ],
  'Nhân viên kinh doanh': [
    { name: 'Đạt doanh thu mục tiêu quý', target: 'Doanh thu ký mới', unit: 'triệu', targetValue: 500 },
    { name: 'Tạo cơ hội bán hàng mới', target: 'Lead đủ điều kiện', unit: 'lead', targetValue: 30 },
  ],
  'Kế toán / Tài chính': [
    { name: 'Hoàn thành báo cáo đúng hạn', target: 'Báo cáo tháng/quý nộp đúng lịch', unit: 'báo cáo', targetValue: 12 },
    { name: 'Đối soát chứng từ chính xác', target: 'Tỷ lệ chứng từ đối soát', unit: '%', targetValue: 99 },
  ],
  Marketing: [
    { name: 'Tăng trưởng qualified leads', target: 'Lead đạt chuẩn từ chiến dịch', unit: 'lead', targetValue: 200 },
    { name: 'Hoàn thành lịch nội dung', target: 'Bài/campaign xuất bản đúng lịch', unit: 'bài', targetValue: 24 },
  ],
  'Vận hành / Operations': [
    { name: 'Đạt SLA xử lý ticket', target: 'Ticket xử lý đúng hạn', unit: '%', targetValue: 95 },
    { name: 'Giảm sự cố vận hành lặp lại', target: 'Sự cố được xử lý triệt để', unit: 'sự cố', targetValue: 10 },
  ],
  'Lãnh đạo / Manager': [
    { name: 'Đạt mục tiêu phòng ban', target: 'OKR phòng ban đạt kế hoạch', unit: '%', targetValue: 90 },
    { name: 'Hoàn thành 1:1 coaching', target: 'Buổi coaching với team', unit: 'buổi', targetValue: 12 },
  ],
  Khác: [
    { name: 'Hoàn thành mục tiêu trọng tâm', target: 'Kết quả chính trong chu kỳ', unit: '%', targetValue: 100 },
    { name: 'Duy trì nhịp cập nhật KPI', target: 'Cập nhật tiến độ định kỳ', unit: 'lần', targetValue: 12 },
  ],
}

const pad2 = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const num = (v) => parseFloat(String(v).replace(',', '.').replace('%', ''))

function cyclePreset(preset, baseYear = new Date().getFullYear()) {
  const now = new Date()
  if (preset === 'next_year') {
    const y = baseYear + 1
    return { name: `Năm ${y}`, type: 'yearly', start: `${y}-01-01`, end: `${y}-12-31` }
  }
  if (preset === 'quarter') {
    const q = Math.floor(now.getMonth() / 3) + 1
    const startMonth = (q - 1) * 3
    const start = new Date(baseYear, startMonth, 1)
    const end = new Date(baseYear, startMonth + 3, 0)
    return { name: `Q${q} ${baseYear}`, type: 'quarterly', start: iso(start), end: iso(end) }
  }
  if (preset === 'month') {
    const start = new Date(baseYear, now.getMonth(), 1)
    const end = new Date(baseYear, now.getMonth() + 1, 0)
    return { name: `Tháng ${pad2(now.getMonth() + 1)}/${baseYear}`, type: 'monthly', start: iso(start), end: iso(end) }
  }
  return { name: `Năm ${baseYear}`, type: 'yearly', start: `${baseYear}-01-01`, end: `${baseYear}-12-31` }
}

export default function OnboardingWizard({ onDone, replay = false }) {
  const currentYear = new Date().getFullYear()
  const defaultCycle = cyclePreset('year', currentYear)
  const [step, setStep] = useState(0)
  const [role, setRole] = useState('')
  const [cycleKind, setCycleKind] = useState(defaultCycle.type)
  const [cycleName, setCycleName] = useState(defaultCycle.name)
  const [cycleStart, setCycleStart] = useState(defaultCycle.start)
  const [cycleEnd, setCycleEnd] = useState(defaultCycle.end)
  const [objectiveName, setObjectiveName] = useState('Mục tiêu chính')
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
  const suggestions = ROLE_SUGGESTIONS[role || 'Khác'] || ROLE_SUGGESTIONS.Khác

  function applySuggestion(s) {
    setKpiName(s.name)
    setKpiTarget(s.target)
    setKpiUnit(s.unit)
    setKpiTargetValue(s.targetValue)
  }

  function applyCyclePreset(preset) {
    const c = cyclePreset(preset, currentYear)
    setCycleKind(c.type)
    setCycleName(c.name)
    setCycleStart(c.start)
    setCycleEnd(c.end)
    setKpiDeadline(c.end)
    setError('')
  }

  function validateCycleForm() {
    if (!cycleName.trim()) return 'Vui lòng nhập tên chu kỳ'
    if (cycleStart && cycleEnd && cycleStart > cycleEnd) return 'Ngày bắt đầu không được sau ngày kết thúc'
    const match = cycleName.match(/\b(19\d{2}|20\d{2})\b/)
    const isYearlyName = cycleKind === 'yearly' || /\b(năm|nam|year)\b/i.test(cycleName)
    if (match && isYearlyName && cycleStart && cycleEnd) {
      const y = Number(match[1])
      if (new Date(cycleStart).getFullYear() !== y || new Date(cycleEnd).getFullYear() !== y) {
        return `Tên chu kỳ đang nhắc tới năm ${y}, nhưng ngày bắt đầu/kết thúc không nằm trọn trong năm đó`
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
    // Bước 1: lưu role (không bắt buộc)
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
    if (!objectiveName.trim()) { setError('Vui lòng nhập tên mục tiêu'); return }
    if (!kpiName.trim()) { setError('Vui lòng nhập tên KPI'); return }
    if (isNaN(tv) || tv <= 0) { setError('Target phải lớn hơn 0'); return }
    if (isNaN(cv) || cv < 0) { setError('Actual hiện tại không được âm'); return }
    if (isNaN(weight) || weight < 0 || weight > 100) { setError('Trọng số KPI phải từ 0 đến 100%'); return }
    setSaving(true); setError('')
    try {
      if (kpiName.trim() && createdCycleId) {
        // Tạo objective rồi gắn KPI đầu tiên vào chu kỳ vừa tạo.
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
      await api.completeOnboarding(role)
      setStep(3)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function handleFinish() {
    try { await api.completeOnboarding(role) } catch (_) { /* ignore */ }
    onDone()
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <button className="onboarding-close" type="button" onClick={handleQuickExit} title={replay ? 'Đóng hướng dẫn' : 'Thoát thiết lập'}>
          ×
        </button>
        {/* Progress */}
        <div className="onboarding-progress">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className={`onboarding-step${i === step ? ' active' : i < step ? ' done' : ''}`}>
              <div className="onboarding-step-dot">{i < step ? '✓' : i + 1}</div>
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* Bước 0: Chào mừng */}
        {step === 0 && (
          <div className="onboarding-content">
            <div className="onboarding-hero">
              <span className="onboarding-logo">K</span>
              <span className="onboarding-kicker">Bước 1 / 4</span>
              <h2>{replay ? 'Xem lại hướng dẫn KPI Companion' : 'Chào mừng đến với KPI Companion!'}</h2>
              <p>{replay
                ? 'Đây là chế độ xem lại hướng dẫn, không lưu dữ liệu mới. Bạn có thể đóng bất cứ lúc nào.'
                : 'Thiết lập một chu kỳ, thêm KPI đầu tiên, rồi để trợ lý theo dõi tiến độ và nhắc đúng lúc.'}</p>
            </div>
            <div className="onboarding-model">
              <div><b>Objective</b><span>Mục tiêu lớn</span></div>
              <div><b>KPI</b><span>Chỉ số đo lường</span></div>
              <div><b>Work item</b><span>Bằng chứng tiến độ</span></div>
            </div>
            <label className="modal-field">
              Vai trò của bạn (tùy chọn)
              <select value={role} onChange={e => setRole(e.target.value)}>
                <option value="">— Chọn vai trò —</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={handleQuickExit} disabled={saving}>{replay ? 'Đóng' : 'Bỏ qua'}</button>
              <button className="btn primary" onClick={handleStep1}>{replay ? 'Xem các bước →' : 'Bắt đầu →'}</button>
            </div>
          </div>
        )}

        {/* Bước 1: Tạo chu kỳ */}
        {step === 1 && (
          <div className="onboarding-content">
            <span className="onboarding-kicker">Bước 2 / 4</span>
            <h3>Tạo chu kỳ đầu tiên</h3>
            <p className="onboarding-hint">{replay
              ? 'Help chỉ minh họa cách chọn chu kỳ; không tạo dữ liệu thật.'
              : 'Chu kỳ là khung thời gian để bạn theo dõi KPI. Bấm tạo ở bước này sẽ lưu một chu kỳ thật.'}</p>
            <div className="onboarding-preset-row">
              <button className="btn small ghost" type="button" onClick={() => applyCyclePreset('year')}>Năm nay</button>
              <button className="btn small ghost" type="button" onClick={() => applyCyclePreset('next_year')}>Năm sau</button>
              <button className="btn small ghost" type="button" onClick={() => applyCyclePreset('quarter')}>Quý hiện tại</button>
              <button className="btn small ghost" type="button" onClick={() => applyCyclePreset('month')}>Tháng hiện tại</button>
            </div>
            <label className="modal-field">
              Kiểu chu kỳ
              <select value={cycleKind} onChange={e => { setCycleKind(e.target.value); setError('') }}>
                <option value="yearly">Năm</option>
                <option value="quarterly">Quý</option>
                <option value="monthly">Tháng</option>
                <option value="custom">Tùy chỉnh</option>
              </select>
            </label>
            <label className="modal-field">
              Tên chu kỳ
              <input value={cycleName} onChange={e => { setCycleName(e.target.value); setError('') }} placeholder="VD: Năm 2026, Q1 2026" />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label className="modal-field" style={{ flex: 1 }}>
                Ngày bắt đầu
                <input type="date" value={cycleStart} onChange={e => { setCycleStart(e.target.value); setError('') }} />
              </label>
              <label className="modal-field" style={{ flex: 1 }}>
                Ngày kết thúc
                <input type="date" value={cycleEnd} onChange={e => { setCycleEnd(e.target.value); setError('') }} />
              </label>
            </div>
            {error && <div className="error-text">⚠️ {error}</div>}
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={() => setStep(0)}>← Quay lại</button>
              <button className="btn ghost" onClick={handleQuickExit} disabled={saving}>{replay ? 'Đóng' : 'Thoát nhanh'}</button>
              <button className="btn primary" onClick={handleStep2} disabled={saving || !cycleName.trim()}>
                {replay ? 'Tiếp tục xem →' : saving ? 'Đang tạo...' : 'Tạo chu kỳ →'}
              </button>
            </div>
          </div>
        )}

        {/* Bước 2: Thêm KPI mẫu */}
        {step === 2 && (
          <div className="onboarding-content">
            <span className="onboarding-kicker">Bước 3 / 4</span>
            <h3>Thêm KPI đầu tiên</h3>
            <p className="onboarding-hint">{replay
              ? 'Help chỉ minh họa form KPI; không lưu KPI mới.'
              : 'Bước này sẽ tạo Objective và KPI thật. Bạn có thể bỏ qua để tự khai báo sau.'}</p>

            <div className="onboarding-kpi-suggestions">
              <p>Gợi ý theo vai trò:</p>
              {suggestions.map(s => (
                <button key={s.name} className="onboarding-suggestion" type="button"
                  onClick={() => applySuggestion(s)}>
                  <b>{s.name}</b>
                  <span>{s.targetValue} {s.unit}</span>
                </button>
              ))}
            </div>

            <label className="modal-field">
              Objective chứa KPI
              <input value={objectiveName} onChange={e => setObjectiveName(e.target.value)} placeholder="VD: Mục tiêu kinh doanh 2026" />
            </label>
            <label className="modal-field">
              Tên KPI
              <input value={kpiName} onChange={e => setKpiName(e.target.value)} placeholder="VD: Hoàn thành 3 khóa đào tạo bắt buộc" />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="modal-field" style={{ flex: '2 1 220px' }}>
                Mục tiêu (mô tả)
                <input value={kpiTarget} onChange={e => setKpiTarget(e.target.value)} placeholder="VD: 3/3 khóa học hoàn thành" />
              </label>
              <label className="modal-field" style={{ flex: '1 1 120px' }}>
                Đơn vị
                <input value={kpiUnit} onChange={e => setKpiUnit(e.target.value)} placeholder="%, khóa học, báo cáo..." />
              </label>
              <label className="modal-field" style={{ flex: '0 1 100px' }}>
                Target
                <input type="number" min="0" step="any" value={kpiTargetValue} onChange={e => setKpiTargetValue(e.target.value)} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="modal-field" style={{ flex: '1 1 120px' }}>
                Actual hiện tại
                <input type="number" min="0" step="any" value={kpiCurrentValue} onChange={e => setKpiCurrentValue(e.target.value)} />
              </label>
              <label className="modal-field" style={{ flex: '1 1 120px' }}>
                Trọng số KPI (%)
                <input type="number" min="0" max="100" step="any" value={kpiWeight} onChange={e => setKpiWeight(e.target.value)} />
              </label>
              <label className="modal-field" style={{ flex: '1 1 140px' }}>
                Deadline
                <input type="date" value={kpiDeadline} onChange={e => setKpiDeadline(e.target.value)} />
              </label>
              <label className="modal-field" style={{ flex: '1 1 120px' }}>
                Loại KPI
                <select value={kpiCategory} onChange={e => setKpiCategory(e.target.value)}>
                  <option value="Work">Công việc</option>
                  <option value="Personal">Cá nhân</option>
                </select>
              </label>
            </div>
            {error && <div className="error-text">⚠️ {error}</div>}
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={() => { setError(''); setStep(1) }}>← Quay lại</button>
              <button className="btn ghost" onClick={async () => {
                setKpiName(''); setSaving(true)
                try { if (!replay) await api.completeOnboarding(role); setStep(3) }
                catch (_) { setStep(3) } finally { setSaving(false) }
              }}>{replay ? 'Tiếp tục xem' : 'Bỏ qua bước này'}</button>
              <button className="btn ghost" onClick={handleQuickExit} disabled={saving}>{replay ? 'Đóng' : 'Thoát nhanh'}</button>
              <button className="btn primary" onClick={handleStep3} disabled={saving || !kpiName.trim()}>
                {replay ? 'Xem hoàn tất →' : saving ? 'Đang lưu...' : 'Lưu KPI →'}
              </button>
            </div>
          </div>
        )}

        {/* Bước 3: Hoàn tất */}
        {step === 3 && (
          <div className="onboarding-content" style={{ textAlign: 'center' }}>
            <span className="onboarding-done-icon">✓</span>
            <span className="onboarding-kicker">Bước 4 / 4</span>
            <h2>{replay ? 'Bạn đã xem xong hướng dẫn' : 'Thiết lập hoàn tất!'}</h2>
            <p>{replay
              ? 'Help không lưu dữ liệu mới. Khi cần tạo KPI thật, hãy vào trang KPI của tôi.'
              : 'Bạn đã sẵn sàng sử dụng KPI Companion. Hãy chat với AI để nhận phân tích và lời khuyên.'}</p>
            <div className="onboarding-actions" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={handleFinish}>{replay ? 'Đóng hướng dẫn' : 'Vào Dashboard →'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
