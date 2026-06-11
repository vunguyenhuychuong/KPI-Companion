import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { api, STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS } from '../api'

const HEALTH = {
  green: { label: 'Đúng tiến độ', color: '#16a34a', bg: '#dcfce7' },
  yellow: { label: 'Cần chú ý', color: '#ca8a04', bg: '#fef9c3' },
  red: { label: 'Rủi ro', color: '#dc2626', bg: '#fee2e2' },
}

function Donut({ value }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 120 120" className="donut">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="12" />
      <circle
        cx="60" cy="60" r={r} fill="none" stroke="#4f46e5" strokeWidth="12"
        strokeDasharray={`${(value / 100) * c} ${c}`} strokeLinecap="round"
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="66" textAnchor="middle" fontSize="24" fontWeight="700" fill="#1e293b">
        {value}%
      </text>
    </svg>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [weekly, setWeekly] = useState('')
  const [loadingWeekly, setLoadingWeekly] = useState(false)

  const load = () => api.dashboard().then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const genWeekly = async () => {
    setLoadingWeekly(true)
    setWeekly('')
    try {
      const res = await api.weeklyReport()
      setWeekly(res.report)
    } catch (e) {
      setWeekly(`⚠️ ${e.message}`)
    } finally {
      setLoadingWeekly(false)
    }
  }

  if (error) return <div className="page"><div className="error-text">⚠️ {error} — backend đã chạy chưa?</div></div>
  if (!data) return <div className="page">Đang tải…</div>

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>📊 Dashboard KPI năm {data.year}</h1>
          <p>Bức tranh tổng thể — nhìn 10 giây là biết KPI nào ổn, KPI nào rủi ro.</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={genWeekly} disabled={loadingWeekly}>
            {loadingWeekly ? 'Agent đang viết…' : '📝 Tổng kết tuần'}
          </button>
          <a className="btn primary" href={api.exportUrl}>📥 Xuất Excel đánh giá</a>
        </div>
      </header>

      <div className="dash-top">
        <div className="card overall">
          <h3>Tổng tiến độ (có trọng số)</h3>
          <Donut value={data.overall_progress} />
        </div>
        <div className="card counts">
          <h3>Đầu việc đã ghi nhận</h3>
          <div className="count-grid">
            {Object.entries(data.counts_by_status).map(([k, v]) => (
              <div className="count-item" key={k}>
                <span className="count-num" style={{ color: STATUS_COLORS[k] }}>{v}</span>
                <span className="count-label">{STATUS_LABELS[k]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card warnings">
          <h3>⚠️ Cảnh báo</h3>
          {data.warnings.length === 0 ? (
            <p className="muted">Không có cảnh báo — mọi KPI đang đúng tiến độ 🎉</p>
          ) : (
            <ul>{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
        </div>
      </div>

      {weekly && (
        <div className="card weekly-report">
          <div dangerouslySetInnerHTML={{ __html: marked.parse(weekly) }} />
        </div>
      )}

      <h2 className="section-title">Chi tiết từng KPI</h2>
      <div className="kpi-grid">
        {data.kpi_statuses.map(({ kpi, expected_progress, health, gap }) => {
          const h = HEALTH[health]
          return (
            <div className="card kpi-card" key={kpi.id} style={{ borderLeft: `4px solid ${h.color}` }}>
              <div className="kpi-card-head">
                <strong>{kpi.name}</strong>
                <span className="health-badge" style={{ color: h.color, background: h.bg }}>{h.label}</span>
              </div>
              <div className="kpi-meta">
                Trọng số {kpi.weight}% · Deadline {kpi.deadline || `${data.year}-12-31`}
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${kpi.progress}%`, background: h.color }} />
                <div className="progress-expected" style={{ left: `${expected_progress}%` }} title={`Kỳ vọng: ${expected_progress}%`} />
              </div>
              <div className="progress-labels">
                <span>Thực tế: <b>{kpi.progress}%</b></span>
                <span>Kỳ vọng: {expected_progress}%</span>
                <span style={{ color: h.color }}>Lệch: {gap > 0 ? '+' : ''}{gap}%</span>
              </div>
            </div>
          )
        })}
      </div>

      <h2 className="section-title">Hoạt động gần đây</h2>
      <div className="card">
        {data.recent_items.length === 0 ? (
          <p className="muted">Chưa có đầu việc nào — hãy kể công việc của bạn cho Trợ lý AI! 💬</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Ngày</th><th>Đầu việc</th><th>Trạng thái</th><th>Nguồn</th><th>+%</th></tr>
            </thead>
            <tbody>
              {data.recent_items.map((w) => (
                <tr key={w.id}>
                  <td>{w.work_date || w.created_at?.slice(0, 10)}</td>
                  <td>{w.title}</td>
                  <td><span className="status-chip" style={{ color: STATUS_COLORS[w.status] }}>{STATUS_LABELS[w.status]}</span></td>
                  <td>{SOURCE_LABELS[w.source] || w.source}</td>
                  <td>{w.progress_delta > 0 ? `+${w.progress_delta}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
