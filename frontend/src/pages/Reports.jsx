import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'

const PERIODS = [
  { key: 'week', label: '📅 Tuần này', hint: null },
  { key: 'month', label: '🗓️ Tháng', hint: 'month' },
  { key: 'quarter', label: '📊 Quý', hint: 'quarter' },
  { key: 'year', label: '🏆 Năm', hint: 'year' },
]

function now() { return new Date() }

export default function Reports() {
  const [saved, setSaved] = useState([])
  const [periodType, setPeriodType] = useState('week')
  const [weekDate, setWeekDate] = useState(now().toISOString().slice(0, 10))
  const [month, setMonth] = useState(`${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}`)
  const [quarter, setQuarter] = useState(`Q${Math.floor(now().getMonth() / 3) + 1}/${now().getFullYear()}`)
  const [year, setYear] = useState(String(now().getFullYear()))
  const [busy, setBusy] = useState(false)
  const [secs, setSecs] = useState(0)
  const [viewing, setViewing] = useState(null)
  const [error, setError] = useState('')

  const load = () => api.savedReports().then(setSaved).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!busy) { setSecs(0); return }
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const label = periodType === 'week' ? weekDate
        : periodType === 'month' ? month
        : periodType === 'quarter' ? quarter
        : year
      const report = await api.generateReport(periodType, label)
      setViewing(report)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const regenerate = async () => {
    if (!viewing) return
    setBusy(true)
    setError('')
    try {
      const report = await api.regenerateReport(viewing.id)
      setViewing(report)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const remove = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Xóa báo cáo này?')) return
    await api.deleteReport(id)
    if (viewing?.id === id) setViewing(null)
    load()
  }

  const copy = () => {
    navigator.clipboard.writeText(viewing.content)
      .then(() => alert('Đã copy nội dung báo cáo — dán thẳng vào email gửi quản lý.'))
  }

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>📝 Báo cáo định kỳ</h1>
          <p>Agent viết báo cáo tuần / tháng / quý / năm, tự so sánh với kế hoạch đã phân rã SMART.</p>
        </div>
        <a className="btn" href={api.exportUrl}>📥 Xuất Excel đánh giá</a>
      </header>

      <div className="card report-controls">
        <div className="period-tabs">
          {PERIODS.map((p) => (
            <button key={p.key}
              className={`period-tab ${periodType === p.key ? 'active' : ''}`}
              onClick={() => setPeriodType(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="form-row">
          {periodType === 'week' && (
            <label>Chọn 1 ngày bất kỳ trong tuần cần báo cáo (xem lại tuần trước cũng được)
              <input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value)} />
            </label>
          )}
          {periodType === 'month' && (
            <label>Chọn tháng
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          )}
          {periodType === 'quarter' && (
            <label>Chọn quý
              <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                {[now().getFullYear() - 1, now().getFullYear()].flatMap((y) =>
                  [1, 2, 3, 4].map((q) => (
                    <option key={`${q}-${y}`} value={`Q${q}/${y}`}>Q{q}/{y}</option>
                  )),
                )}
              </select>
            </label>
          )}
          {periodType === 'year' && (
            <label>Chọn năm
              <input type="number" style={{ width: 100 }} value={year} onChange={(e) => setYear(e.target.value)} />
            </label>
          )}
          <button className="btn primary" onClick={generate} disabled={busy}>
            {busy ? `Agent đang viết… ${secs}s` : '✨ Tạo báo cáo'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          💡 Tạo lại báo cáo của một kỳ đã có sẽ <b>cập nhật đè</b> bản cũ với dữ liệu mới nhất — không tạo bản trùng.
        </p>
      </div>

      {error && <div className="error-text">⚠️ {error}</div>}

      <div className="report-layout">
        <div className="report-list">
          <h3 className="muted">Báo cáo đã tạo</h3>
          {saved.length === 0 && <p className="muted">Chưa có báo cáo nào.</p>}
          {saved.map((r) => (
            <div key={r.id}
              className={`report-item ${viewing?.id === r.id ? 'active' : ''}`}
              onClick={() => setViewing(r)}>
              <div>
                <b>{r.period_label}</b>
                <div className="muted">{r.created_at?.slice(0, 16).replace('T', ' ')}</div>
              </div>
              <button className="btn-icon" title="Xóa" onClick={(e) => remove(e, r.id)}>✕</button>
            </div>
          ))}
        </div>

        <div className="report-view card">
          {viewing ? (
            <>
              <div className="report-view-head">
                <span className="muted">Cập nhật lúc {viewing.created_at?.slice(0, 16).replace('T', ' ')}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn small" onClick={regenerate} disabled={busy}
                    title="Viết lại báo cáo kỳ này với dữ liệu mới nhất (đè bản cũ)">
                    {busy ? `Đang viết lại… ${secs}s` : '🔄 Tạo lại'}
                  </button>
                  <button className="btn small" onClick={copy}>📋 Copy gửi quản lý</button>
                </div>
              </div>
              <div className="report-content" dangerouslySetInnerHTML={{ __html: marked.parse(viewing.content) }} />
            </>
          ) : (
            <p className="muted">Chọn kỳ và bấm <b>Tạo báo cáo</b>, hoặc chọn một báo cáo đã tạo bên trái để xem.</p>
          )}
        </div>
      </div>
    </div>
  )
}
