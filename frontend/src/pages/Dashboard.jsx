import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { api, STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS } from '../api'

const HEALTH = {
    green: { label: 'Đúng tiến độ', color: '#16a34a', bg: '#dcfce7' },
    yellow: { label: 'Cần chú ý', color: '#ca8a04', bg: '#fef9c3' },
    red: { label: 'Rủi ro', color: '#dc2626', bg: '#fee2e2' },
}

function WeeklyBars({ data }) {
    const max = Math.max(1, ...data.map((d) => d.count))
    const W = 320, H = 120, pad = 4
    const bw = (W - pad * 2) / data.length
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
            {data.map((d, i) => {
                const h = (d.count / max) * (H - 38)
                return (
                    <g key={i}>
                        <rect
                            x={pad + i * bw + 5} y={H - 24 - h} width={bw - 10} height={Math.max(h, 2)}
                            rx="5" fill={d.count > 0 ? 'url(#barGrad)' : '#e9eaf6'}
                        />
                        {d.count > 0 && (
                            <text x={pad + i * bw + bw / 2} y={H - 29 - h} textAnchor="middle" fontSize="11" fontWeight="700" fill="#4f46e5">
                                {d.count}
                            </text>
                        )}
                        <text x={pad + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#6b7194">
                            {d.label}
                        </text>
                    </g>
                )
            })}
            <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
            </defs>
        </svg>
    )
}

function GapBars({ statuses }) {
    const rows = statuses.slice(0, 8)
    const max = Math.max(10, ...rows.map((s) => Math.abs(s.gap)))
    return (
        <div className="gap-chart">
            {rows.map(({ kpi, gap, health }) => (
                <div className="gap-row" key={kpi.id} title={`${kpi.name}: lệch ${gap > 0 ? '+' : ''}${gap}% so với kỳ vọng`}>
                    <span className="gap-name">{kpi.name}</span>
                    <div className="gap-track">
                        <div className="gap-mid" />
                        <div
                            className="gap-fill"
                            style={{
                                width: `${(Math.abs(gap) / max) * 50}%`,
                                left: gap >= 0 ? '50%' : `${50 - (Math.abs(gap) / max) * 50}%`,
                                background: HEALTH[health].color,
                            }}
                        />
                    </div>
                    <span className="gap-val" style={{ color: HEALTH[health].color }}>
            {gap > 0 ? '+' : ''}{gap}%
          </span>
                </div>
            ))}
        </div>
    )
}

function Donut({ value }) {
    const r = 52
    const c = 2 * Math.PI * r
    return (
        <svg viewBox="0 0 120 120" className="donut">
            <defs>
                <linearGradient id="donutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
            </defs>
            <circle cx="60" cy="60" r={r} fill="none" stroke="#e9eaf6" strokeWidth="12" />
            <circle
                cx="60" cy="60" r={r} fill="none" stroke="url(#donutGrad)" strokeWidth="12"
                strokeDasharray={`${(Math.min(100, value) / 100) * c} ${c}`} strokeLinecap="round"
                transform="rotate(-90 60 60)"
            />
            <text x="60" y="66" textAnchor="middle" fontSize="24" fontWeight="700" fill="#1e2235">
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
    const [filterObj, setFilterObj] = useState(null) // null = tat ca; -1 = chua gan; id
    const [completing, setCompleting] = useState(null) // {id, delta} - dang nhap +delta de hoan thanh

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

            {data.todo_items?.length > 0 && (
                <>
                    <h2 className="section-title">📌 Việc cần làm ({data.todo_items.length})</h2>
                    <div className="card">
                        {data.todo_items.map((w) => {
                            const kpiOfItem = data.kpi_statuses.find((s) => s.kpi.id === w.kpi_id)?.kpi
                            const today = new Date().toISOString().slice(0, 10)
                            const overdueDays = w.work_date && w.work_date < today
                                ? Math.round((new Date(today) - new Date(w.work_date)) / 86400000) : 0
                            const isCompleting = completing?.id === w.id
                            return (
                                <div className={`todo-row ${overdueDays > 0 ? 'overdue' : ''}`} key={w.id}>
                                    <button
                                        className="todo-check"
                                        title="Đánh dấu đã hoàn thành"
                                        onClick={() => {
                                            if (kpiOfItem) setCompleting({ id: w.id, delta: '' })
                                            else api.updateWorkItemStatus(w.id, 'da_lam').then(load)
                                        }}
                                    >✓</button>
                                    <div className="todo-main">
                                        <span className="todo-title">{w.title}</span>
                                        <span className="muted">
                      {w.work_date ? `📅 ${w.work_date} · ` : ''}
                                            {kpiOfItem ? `🎯 ${kpiOfItem.name} · ` : ''}
                                            {SOURCE_LABELS[w.source] || w.source}
                    </span>
                                    </div>
                                    {overdueDays > 0 && (
                                        <span className="overdue-badge">⏰ Quá hạn {overdueDays} ngày</span>
                                    )}
                                    {isCompleting ? (
                                        <span className="todo-complete-strip">
                      +
                      <input
                          type="number" step="any" autoFocus placeholder="0"
                          value={completing.delta}
                          onChange={(e) => setCompleting({ ...completing, delta: e.target.value })}
                          onKeyDown={(e) => e.key === 'Escape' && setCompleting(null)}
                      />
                                            {kpiOfItem.unit}
                                            <button className="btn small primary"
                                                    onClick={async () => {
                                                        await api.updateWorkItemStatus(w.id, 'da_lam', Number(completing.delta) || 0)
                                                        setCompleting(null)
                                                        load()
                                                    }}>Hoàn thành</button>
                      <button className="btn small ghost" onClick={() => setCompleting(null)}>Hủy</button>
                    </span>
                                    ) : (
                                        <span className="status-chip" style={{ color: STATUS_COLORS[w.status] }}>
                      {STATUS_LABELS[w.status]}
                    </span>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </>
            )}

            <div className="charts-row">
                <div className="card">
                    <h3>📈 Nhịp ghi nhận 8 tuần gần nhất</h3>
                    <WeeklyBars data={data.weekly_activity || []} />
                </div>
                <div className="card">
                    <h3>⚖️ Lệch so với kỳ vọng theo KPI</h3>
                    <GapBars statuses={data.kpi_statuses} />
                </div>
            </div>

            {data.objectives?.length > 0 && (
                <>
                    <h2 className="section-title">Mục tiêu năm (Objectives) <span className="muted" style={{ fontWeight: 400 }}>— bấm vào thẻ để lọc KPI bên dưới</span></h2>
                    <div className="objective-cards">
                        {data.objectives.map((o) => {
                            const children = data.kpi_statuses.filter((s) => s.kpi.objective_id === o.id)
                            const dist = { green: 0, yellow: 0, red: 0 }
                            children.forEach((s) => { dist[s.health]++ })
                            const active = filterObj === o.id
                            return (
                                <div
                                    className={`card objective-card clickable ${active ? 'selected' : ''}`}
                                    key={o.id}
                                    onClick={() => setFilterObj(active ? null : o.id)}
                                >
                                    <div className="objective-card-head">
                                        <strong>🏁 {o.name}</strong>
                                        <span className="kpi-count-badge">{o.kpi_count} KPI</span>
                                    </div>
                                    <div className="health-dist">
                                        {dist.green > 0 && <span className="dist-chip green">🟢 {dist.green} đúng tiến độ</span>}
                                        {dist.yellow > 0 && <span className="dist-chip yellow">🟡 {dist.yellow} cần chú ý</span>}
                                        {dist.red > 0 && <span className="dist-chip red">🔴 {dist.red} rủi ro</span>}
                                        {children.length === 0 && <span className="muted">chưa có KPI</span>}
                                    </div>
                                    <div className="progress-track">
                                        <div className="progress-fill" style={{ width: `${Math.min(100, o.progress)}%`, background: '#4f46e5' }} />
                                    </div>
                                    <div className="progress-labels">
                                        <span>Tiến độ: <b>{o.progress}%</b></span>
                                        <span>Trọng số: {o.weight}%</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </>
            )}

            <h2 className="section-title">
                Chi tiết từng KPI
                {filterObj !== null && (
                    <button className="btn small ghost" style={{ marginLeft: 10 }} onClick={() => setFilterObj(null)}>
                        ✕ Bỏ lọc: {data.objectives.find((o) => o.id === filterObj)?.name}
                    </button>
                )}
            </h2>
            <div className="kpi-grid">
                {data.kpi_statuses
                    .filter((s) => filterObj === null || s.kpi.objective_id === filterObj)
                    .map(({ kpi, expected_progress, health, gap }) => {
                        const h = HEALTH[health]
                        return (
                            <div className="card kpi-card" key={kpi.id} style={{ borderLeft: `4px solid ${h.color}` }}>
                                <div className="kpi-card-head">
                                    <strong>{kpi.name}</strong>
                                    <span className="health-badge" style={{ color: h.color, background: h.bg }}>
                  {kpi.progress > 100 ? '🌟 Vượt chỉ tiêu' : h.label}
                </span>
                                </div>
                                <div className="kpi-meta">
                                    {kpi.objective_name && <span className="meta-seg">🏁 {kpi.objective_name}</span>}
                                    <span className="meta-seg">
                  Thực đạt {kpi.unit === '%' ? `${kpi.current_value}%` : `${kpi.current_value}/${kpi.target_value} ${kpi.unit}`}
                </span>
                                    <span className="meta-seg">Trọng số {kpi.weight}%</span>
                                    <span className="meta-seg">⏳ {kpi.deadline || `${data.year}-12-31`}</span>
                                </div>
                                <div className="progress-track">
                                    <div className="progress-fill" style={{ width: `${Math.min(100, kpi.progress)}%`, background: h.color }} />
                                    <div className="progress-expected" style={{ left: `${Math.min(100, expected_progress)}%` }} title={`Kỳ vọng: ${expected_progress}%`} />
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
                        <tr>
                            <th title="Ngày công việc được thực hiện (Agent suy ra từ mô tả hoặc nguồn dữ liệu)">Ngày thực hiện</th>
                            <th title="Thời điểm bạn bấm Xác nhận để ghi vào hệ thống">Ghi nhận lúc</th>
                            <th>Đầu việc</th><th>Trạng thái</th><th>Nguồn</th><th>+Thực đạt</th>
                        </tr>
                        </thead>
                        <tbody>
                        {data.recent_items.map((w) => (
                            <tr key={w.id}>
                                <td className="nowrap">{w.work_date || <span className="muted">—</span>}</td>
                                <td className="nowrap muted">{w.created_at?.slice(0, 16).replace('T', ' ')}</td>
                                <td>{w.title}</td>
                                <td><span className="status-chip" style={{ color: STATUS_COLORS[w.status] }}>{STATUS_LABELS[w.status]}</span></td>
                                <td>{SOURCE_LABELS[w.source] || w.source}</td>
                                <td>{w.progress_delta ? `${w.progress_delta > 0 ? '+' : ''}${w.progress_delta}` : '—'}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
