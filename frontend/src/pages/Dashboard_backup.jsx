import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { api, STATUS_COLORS, SOURCE_LABELS } from '../api'
import { useLang } from '../LangContext'

const HEALTH_COLORS = { green: '#16a34a', yellow: '#ca8a04', red: '#dc2626' }

// Donut cơ cấu sức khỏe KPI: tỷ lệ KPI đúng tiến độ / cần chú ý / rủi ro
function HealthDonut({ statuses, tr }) {
    const total = statuses.length
    const counts = { green: 0, yellow: 0, red: 0 }
    statuses.forEach((s) => { counts[s.health]++ })
    const r = 52, c = 2 * Math.PI * r
    const order = ['green', 'yellow', 'red']
    let offset = 0
    const segs = order.map((h) => {
        const len = total ? (counts[h] / total) * c : 0
        const seg = { h, len, offset }
        offset += len
        return seg
    }).filter((s) => s.len > 0)
    return (
        <div className="health-donut-wrap">
            <svg viewBox="0 0 120 120" className="donut">
                <circle cx="60" cy="60" r={r} fill="none" stroke="#eef0fa" strokeWidth="13" />
                {segs.map((s) => (
                    <circle
                        key={s.h} cx="60" cy="60" r={r} fill="none" stroke={HEALTH_COLORS[s.h]} strokeWidth="13"
                        strokeDasharray={`${s.len} ${c - s.len}`} strokeDashoffset={-s.offset}
                        transform="rotate(-90 60 60)"
                    />
                ))}
                <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="700" fill="#1e2235">{total}</text>
                <text x="60" y="74" textAnchor="middle" fontSize="10" fill="#6b7194">KPI</text>
            </svg>
            <div className="health-legend">
                {order.map((h) => (
                    <div className="health-legend-row" key={h}>
                        <span className="health-legend-dot" style={{ background: HEALTH_COLORS[h] }} />
                        <span className="health-legend-label">{tr(`dashboard.health_${h}`)}</span>
                        <span className="health-legend-count">{counts[h]}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// Danh sách KPI rủi ro cần ưu tiên: KPI tụt sau kỳ vọng, sắp theo mức chậm × trọng số
function RiskList({ statuses, tr, year }) {
    const today = new Date()
    const behind = statuses
        .filter((s) => s.gap < 0)
        .map((s) => ({ ...s, priority: Math.abs(s.gap) * (s.kpi.weight || 1) }))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 6)
    if (behind.length === 0) {
        return <p className="muted risk-empty">{tr('dashboard.risk_empty')}</p>
    }
    return (
        <div className="risk-list">
            {behind.map(({ kpi, gap, health }) => {
                const color = HEALTH_COLORS[health]
                const dl = kpi.deadline || `${year}-12-31`
                const days = Math.ceil((new Date(dl) - today) / 86400000)
                return (
                    <div className="risk-row" key={kpi.id} style={{ borderLeftColor: color }}>
                        <div className="risk-main">
                            <span className="risk-name" title={kpi.name}>{kpi.name}</span>
                            <div className="risk-tags">
                                <span className="risk-tag" style={{ color, background: `${color}14` }}>
                                    {tr('dashboard.risk_behind', { gap: Math.abs(gap) })}
                                </span>
                                <span className="risk-tag muted-tag">{tr('dashboard.risk_weight', { weight: kpi.weight })}</span>
                                <span className="risk-tag muted-tag">
                                    {days >= 0
                                        ? tr('dashboard.risk_days', { days })
                                        : tr('dashboard.risk_overdue', { days: -days })}
                                </span>
                            </div>
                        </div>
                        <div className="risk-bar">
                            <div className="risk-bar-fill" style={{ width: `${Math.min(100, kpi.progress)}%`, background: color }} />
                            <div className="risk-bar-exp" style={{ left: `${Math.min(100, kpi.progress - gap)}%` }} />
                        </div>
                    </div>
                )
            })}
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
    const { tr, statusLabels, sourceLabels } = useLang()
    const SL = statusLabels()
    const SRC = sourceLabels()

    const HEALTH = {
        green: { label: tr('dashboard.health_green'), color: '#16a34a', bg: '#dcfce7' },
        yellow: { label: tr('dashboard.health_yellow'), color: '#ca8a04', bg: '#fef9c3' },
        red: { label: tr('dashboard.health_red'), color: '#dc2626', bg: '#fee2e2' },
    }

    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [weekly, setWeekly] = useState('')
    const [loadingWeekly, setLoadingWeekly] = useState(false)
    const [filterObj, setFilterObj] = useState(null)
    const [completing, setCompleting] = useState(null)

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

    if (error) return <div className="page"><div className="error-text">⚠️ {error} — {tr('dashboard.error')}</div></div>
    if (!data) return <div className="page">{tr('dashboard.loading')}</div>

    return (
        <div className="page">
            <header className="page-header row">
                <div>
                    <h1>{tr('dashboard.title', { year: data.year })}</h1>
                    <p>{tr('dashboard.subtitle')}</p>
                </div>
                <div className="header-actions">
                    <button className="btn" onClick={genWeekly} disabled={loadingWeekly}>
                        {loadingWeekly ? tr('dashboard.agent_writing') : tr('dashboard.btn_weekly')}
                    </button>
                    <button className="btn primary" onClick={() => api.exportEvaluation().catch((e) => alert(e.message))}>
                        {tr('dashboard.btn_export')}
                    </button>
                </div>
            </header>

            <div className="dash-top">
                <div className="card overall">
                    <h3>{tr('dashboard.card_progress')}</h3>
                    <Donut value={data.overall_progress} />
                </div>
                <div className="card counts">
                    <h3>{tr('dashboard.card_items')}</h3>
                    <div className="count-grid">
                        {Object.entries(data.counts_by_status).map(([k, v]) => (
                            <div className="count-item" key={k}>
                                <span className="count-num" style={{ color: STATUS_COLORS[k] }}>{v}</span>
                                <span className="count-label">{SL[k] ?? k}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="card warnings">
                    <h3>{tr('dashboard.card_warnings')}</h3>
                    {data.warnings.length === 0 ? (
                        <p className="muted">{tr('dashboard.no_warnings')}</p>
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
                    <h2 className="section-title">{tr('dashboard.todo_title', { count: data.todo_items.length })}</h2>
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
                                        title={tr('dashboard.mark_done')}
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
                                            {SRC[w.source] ?? SOURCE_LABELS[w.source] ?? w.source}
                                        </span>
                                    </div>
                                    {overdueDays > 0 && (
                                        <span className="overdue-badge">{tr('dashboard.overdue', { days: overdueDays })}</span>
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
                                                }}>{tr('dashboard.complete_btn')}</button>
                                            <button className="btn small ghost" onClick={() => setCompleting(null)}>{tr('dashboard.cancel_btn')}</button>
                                        </span>
                                    ) : (
                                        <span className="status-chip" style={{ color: STATUS_COLORS[w.status] }}>
                                            {SL[w.status] ?? w.status}
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
                    <h3>{tr('dashboard.chart_health')}</h3>
                    <HealthDonut statuses={data.kpi_statuses} tr={tr} />
                </div>
                <div className="card">
                    <h3>{tr('dashboard.chart_risk')}</h3>
                    <RiskList statuses={data.kpi_statuses} tr={tr} year={data.year} />
                </div>
            </div>

            {data.objectives?.length > 0 && (
                <>
                    <h2 className="section-title">
                        {tr('dashboard.objectives_title')}
                        <span className="muted" style={{ fontWeight: 400 }}> {tr('dashboard.objectives_hint')}</span>
                    </h2>
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
                                        {dist.green > 0 && <span className="dist-chip green">{tr('dashboard.health_on_track', { count: dist.green })}</span>}
                                        {dist.yellow > 0 && <span className="dist-chip yellow">{tr('dashboard.health_attention', { count: dist.yellow })}</span>}
                                        {dist.red > 0 && <span className="dist-chip red">{tr('dashboard.health_risk', { count: dist.red })}</span>}
                                        {children.length === 0 && <span className="muted">{tr('dashboard.no_kpis')}</span>}
                                    </div>
                                    <div className="progress-track">
                                        <div className="progress-fill" style={{ width: `${Math.min(100, o.progress)}%`, background: '#4f46e5' }} />
                                    </div>
                                    <div className="progress-labels">
                                        <span>{tr('dashboard.progress_label')} <b>{o.progress}%</b></span>
                                        <span>{tr('dashboard.weight_label')} {o.weight}%</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </>
            )}

            <h2 className="section-title">
                {tr('dashboard.kpi_detail_title')}
                {filterObj !== null && (
                    <button className="btn small ghost" style={{ marginLeft: 10 }} onClick={() => setFilterObj(null)}>
                        {tr('dashboard.filter_clear', { name: data.objectives.find((o) => o.id === filterObj)?.name })}
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
                                        {kpi.progress > 100 ? tr('dashboard.excellence') : h.label}
                                    </span>
                                </div>
                                <div className="kpi-meta">
                                    {kpi.objective_name && <span className="meta-seg">🏁 {kpi.objective_name}</span>}
                                    <span className="meta-seg">
                                        {kpi.unit === '%'
                                            ? tr('dashboard.actual_pct', { value: kpi.current_value })
                                            : tr('dashboard.actual_num', { current: kpi.current_value, target: kpi.target_value, unit: kpi.unit })}
                                    </span>
                                    <span className="meta-seg">{tr('dashboard.weight_pct', { weight: kpi.weight })}</span>
                                    <span className="meta-seg">⏳ {kpi.deadline || `${data.year}-12-31`}</span>
                                </div>
                                <div className="progress-track">
                                    <div className="progress-fill" style={{ width: `${Math.min(100, kpi.progress)}%`, background: h.color }} />
                                    <div className="progress-expected" style={{ left: `${Math.min(100, expected_progress)}%` }} title={`${tr('dashboard.expected_label')} ${expected_progress}%`} />
                                </div>
                                <div className="progress-labels">
                                    <span>{tr('dashboard.actual_label')} <b>{kpi.progress}%</b></span>
                                    <span>{tr('dashboard.expected_label')} {expected_progress}%</span>
                                    <span style={{ color: h.color }}>{tr('dashboard.gap_label')} {gap > 0 ? '+' : ''}{gap}%</span>
                                </div>
                            </div>
                        )
                    })}
            </div>

            <h2 className="section-title">{tr('dashboard.recent_title')}</h2>
            <div className="card">
                {data.recent_items.length === 0 ? (
                    <p className="muted">{tr('dashboard.no_items')}</p>
                ) : (
                    <table className="table">
                        <thead>
                        <tr>
                            <th>{tr('dashboard.col_work_date')}</th>
                            <th>{tr('dashboard.col_recorded')}</th>
                            <th>{tr('dashboard.col_task')}</th>
                            <th>{tr('dashboard.col_status')}</th>
                            <th>{tr('dashboard.col_source')}</th>
                            <th>{tr('dashboard.col_delta')}</th>
                        </tr>
                        </thead>
                        <tbody>
                        {data.recent_items.map((w) => (
                            <tr key={w.id}>
                                <td className="nowrap">{w.work_date || <span className="muted">—</span>}</td>
                                <td className="nowrap muted">{w.created_at?.slice(0, 19).replace('T', ' ')}</td>
                                <td>{w.title}</td>
                                <td><span className="status-chip" style={{ color: STATUS_COLORS[w.status] }}>{SL[w.status] ?? w.status}</span></td>
                                <td>{SRC[w.source] ?? SOURCE_LABELS[w.source] ?? w.source}</td>
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
