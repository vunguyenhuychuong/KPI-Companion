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

export default function OnboardingWizard({ onDone, replay = false }) {
  const [step, setStep] = useState(0)
  const [role, setRole] = useState('')
  const [cycleName, setCycleName] = useState(`Năm ${new Date().getFullYear()}`)
  const [cycleStart, setCycleStart] = useState(`${new Date().getFullYear()}-01-01`)
  const [cycleEnd, setCycleEnd] = useState(`${new Date().getFullYear()}-12-31`)
  const [kpiName, setKpiName] = useState('')
  const [kpiTarget, setKpiTarget] = useState('')
  const [kpiUnit, setKpiUnit] = useState('%')
  const [kpiTargetValue, setKpiTargetValue] = useState(100)
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
    if (!cycleName.trim()) { setError('Vui lòng nhập tên chu kỳ'); return }
    setSaving(true); setError('')
    try {
      const cycle = await api.createCycle({
        name: cycleName.trim(),
        cycle_type: 'yearly',
        start_date: cycleStart || null,
        end_date: cycleEnd || null,
      })
      setCreatedCycleId(cycle.id)
      setStep(2)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function handleStep3() {
    setSaving(true); setError('')
    try {
      if (kpiName.trim() && createdCycleId) {
        // Tạo objective mặc định rồi gắn KPI vào
        const obj = await api.createObjective({
          name: 'Mục tiêu chính',
          weight: 100,
          cycle_id: createdCycleId,
        })
        await api.createKpi({
          name: kpiName.trim(),
          target: kpiTarget.trim(),
          unit: kpiUnit,
          target_value: parseFloat(kpiTargetValue) || 100,
          weight: 100,
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
              <p>Thiết lập một chu kỳ, thêm KPI đầu tiên, rồi để trợ lý theo dõi tiến độ và nhắc đúng lúc.</p>
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
              <button className="btn ghost" onClick={handleSkip} disabled={saving}>Bỏ qua</button>
              <button className="btn primary" onClick={handleStep1}>Bắt đầu →</button>
            </div>
          </div>
        )}

        {/* Bước 1: Tạo chu kỳ */}
        {step === 1 && (
          <div className="onboarding-content">
            <span className="onboarding-kicker">Bước 2 / 4</span>
            <h3>Tạo chu kỳ đầu tiên</h3>
            <p className="onboarding-hint">Chu kỳ là khung thời gian để bạn theo dõi KPI (năm, quý, tháng).</p>
            <label className="modal-field">
              Tên chu kỳ
              <input value={cycleName} onChange={e => setCycleName(e.target.value)} placeholder="VD: Năm 2026, Q1 2026" />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label className="modal-field" style={{ flex: 1 }}>
                Ngày bắt đầu
                <input type="date" value={cycleStart} onChange={e => setCycleStart(e.target.value)} />
              </label>
              <label className="modal-field" style={{ flex: 1 }}>
                Ngày kết thúc
                <input type="date" value={cycleEnd} onChange={e => setCycleEnd(e.target.value)} />
              </label>
            </div>
            {error && <div className="error-text">⚠️ {error}</div>}
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={() => setStep(0)}>← Quay lại</button>
              <button className="btn primary" onClick={handleStep2} disabled={saving || !cycleName.trim()}>
                {saving ? 'Đang tạo...' : 'Tạo chu kỳ →'}
              </button>
            </div>
          </div>
        )}

        {/* Bước 2: Thêm KPI mẫu */}
        {step === 2 && (
          <div className="onboarding-content">
            <span className="onboarding-kicker">Bước 3 / 4</span>
            <h3>Thêm KPI đầu tiên</h3>
            <p className="onboarding-hint">Bắt đầu với một KPI đơn giản để làm quen. Bạn có thể thêm nhiều hơn sau.</p>

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
              Tên KPI
              <input value={kpiName} onChange={e => setKpiName(e.target.value)} placeholder="VD: Hoàn thành 3 khóa đào tạo bắt buộc" />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label className="modal-field" style={{ flex: 2 }}>
                Mục tiêu (mô tả)
                <input value={kpiTarget} onChange={e => setKpiTarget(e.target.value)} placeholder="VD: 3/3 khóa học hoàn thành" />
              </label>
              <label className="modal-field" style={{ flex: 1 }}>
                Đơn vị
                <input value={kpiUnit} onChange={e => setKpiUnit(e.target.value)} placeholder="%, khóa học, báo cáo..." />
              </label>
              <label className="modal-field" style={{ width: 80 }}>
                Target
                <input type="number" value={kpiTargetValue} onChange={e => setKpiTargetValue(e.target.value)} />
              </label>
            </div>
            {error && <div className="error-text">⚠️ {error}</div>}
            <div className="onboarding-actions">
              <button className="btn ghost" onClick={() => { setError(''); setStep(1) }}>← Quay lại</button>
              <button className="btn ghost" onClick={async () => {
                setKpiName(''); setSaving(true)
                try { await api.completeOnboarding(role); setStep(3) }
                catch (_) { setStep(3) } finally { setSaving(false) }
              }}>Bỏ qua bước này</button>
              <button className="btn primary" onClick={handleStep3} disabled={saving || !kpiName.trim()}>
                {saving ? 'Đang lưu...' : 'Lưu KPI →'}
              </button>
            </div>
          </div>
        )}

        {/* Bước 3: Hoàn tất */}
        {step === 3 && (
          <div className="onboarding-content" style={{ textAlign: 'center' }}>
            <span className="onboarding-done-icon">✓</span>
            <span className="onboarding-kicker">Bước 4 / 4</span>
            <h2>Thiết lập hoàn tất!</h2>
            <p>Bạn đã sẵn sàng sử dụng KPI Companion. Hãy chat với AI để nhận phân tích và lời khuyên.</p>
            <div className="onboarding-actions" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={handleFinish}>Vào Dashboard →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
