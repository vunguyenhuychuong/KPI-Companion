import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'
import ProposalList from './ProposalList'

const HC = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' }
const HL = { green: 'Đúng tiến độ', yellow: 'Cần chú ý', red: 'Rủi ro' }

function CoachPanel({ kpi, lang, onConfirmed }) {
    const [open, setOpen] = useState(false)
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [err, setErr] = useState('')
    const [secs, setSecs] = useState(0)

    const run = async () => {
        setOpen(true); setLoading(true); setErr(''); setData(null); setSecs(0)
        const t = setInterval(() => setSecs(s => s + 1), 1000)
        try { setData(await api.coachKpi(kpi.id, lang)) }
        catch (e) { setErr(e.message) }
        finally { clearInterval(t); setLoading(false) }
    }

    useEffect(() => {
        if (localStorage.getItem('kpi_autocoach') === '1') run()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="coach-wrap">
            <button className="btn small ghost coach-btn"
                onClick={data && !loading ? () => setOpen(o => !o) : run}
                disabled={loading}>
                {loading ? `Đang phân tích… ${secs}s` : open ? 'Ẩn AI Coach' : 'AI Coach'}
            </button>
            {open && (
                <div className="coach-panel">
                    {err && <p className="error-text">⚠️ {err}</p>}
                    {data && !loading && (
                        <>
                            <div className="coach-analysis" dangerouslySetInnerHTML={{ __html: marked.parse(data.analysis || '') }} />
                            {data.root_causes?.length > 0 && (
                                <div className="coach-causes">
                                    <strong>Nguyên nhân gốc rễ</strong>
                                    <ul>{data.root_causes.map((c, i) => (
                                        <li key={i}>{c.cause}{c.question && <em> — {c.question}</em>}</li>
                                    ))}</ul>
                                </div>
                            )}
                            {data.proposed_items?.length > 0 && (
                                <>
                                    <strong className="coach-actions-title">Hành động đề xuất</strong>
                                    <ProposalList
                                        items={data.proposed_items}
                                        onConfirmed={() => { setOpen(false); onConfirmed?.() }}
                                        onDismiss={() => setOpen(false)}
                                    />
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

export default function KpiDetailDrawer({ item, year, onClose, onReload, lang }) {
    const { kpi, expected_progress, health, gap } = item
    const c = HC[health]
    const r = 44, circum = 2 * Math.PI * r
    const filled = (Math.min(100, kpi.progress) / 100) * circum
    const dl = kpi.deadline || `${year}-12-31`
    const daysLeft = Math.ceil((new Date(dl) - new Date()) / 86400000)

    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        document.body.style.overflow = 'hidden'
        return () => {
            window.removeEventListener('keydown', onKey)
            document.body.style.overflow = ''
        }
    }, [onClose])

    return (
        <>
            <div className="ddb-backdrop" onClick={onClose} />
            <div className="ddb-drawer" role="dialog" aria-modal="true">
                {/* Header */}
                <div className="ddb-drawer-hd">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ddb-drawer-title">{kpi.name}</div>
                        {kpi.objective_name && (
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                                🏁 {kpi.objective_name}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: c + '22', color: c }}>
                            {kpi.progress > 100 ? 'Vượt chỉ tiêu' : HL[health]}
                        </span>
                        <button className="btn-icon" onClick={onClose} style={{ fontSize: 22 }}>×</button>
                    </div>
                </div>

                <div className="ddb-drawer-body">
                    {/* Ring + 4 stats */}
                    <div className="ddb-drawer-ring-row">
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                            <svg viewBox="0 0 100 100" style={{ width: 90, height: 90 }}>
                                <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
                                <circle cx="50" cy="50" r={r} fill="none" stroke={c} strokeWidth="9"
                                    strokeDasharray={`${filled} ${circum}`}
                                    strokeLinecap="round" transform="rotate(-90 50 50)" />
                            </svg>
                            <div style={{
                                position: 'absolute', inset: 0, display: 'flex',
                                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <span style={{ fontSize: 18, fontWeight: 800, color: c, lineHeight: 1 }}>{kpi.progress}%</span>
                                <span style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>tiến độ</span>
                            </div>
                        </div>

                        <div className="ddb-drawer-stats">
                            {[
                                ['Thực tế', `${kpi.current_value} ${kpi.unit}`],
                                ['Mục tiêu', `${kpi.target_value} ${kpi.unit}`],
                                ['Kỳ vọng', `${expected_progress}%`],
                                ['Lệch', `${gap > 0 ? '+' : ''}${gap}%`, c],
                            ].map(([label, val, color]) => (
                                <div className="ddb-drawer-stat" key={label}>
                                    <span className="ddb-drawer-stat-label">{label}</span>
                                    <span className="ddb-drawer-stat-val" style={color ? { color } : undefined}>{val}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Progress bar with expected marker */}
                    <div className="ddb-drawer-progress">
                        <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'visible', position: 'relative' }}>
                            <div style={{
                                height: '100%', width: `${Math.min(100, kpi.progress)}%`,
                                background: c, borderRadius: 4, overflow: 'hidden',
                            }} />
                            <div style={{
                                position: 'absolute', left: `${Math.min(100, expected_progress)}%`,
                                top: -3, bottom: -3, width: 2,
                                background: 'var(--text)', opacity: 0.45, borderRadius: 1,
                            }} title={`Kỳ vọng: ${expected_progress}%`} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
                            <span>Thực tế <b style={{ color: 'var(--text)' }}>{kpi.progress}%</b></span>
                            <span>Kỳ vọng <b style={{ color: 'var(--text)' }}>{expected_progress}%</b></span>
                        </div>
                    </div>

                    {/* Meta table */}
                    <div className="ddb-drawer-meta">
                        {[
                            ['Trọng số', `${kpi.weight}%`],
                            ['Deadline', dl, daysLeft < 0 ? HC.red : daysLeft < 30 ? HC.yellow : undefined],
                            ['Còn lại', daysLeft >= 0 ? `${daysLeft} ngày` : `Quá ${-daysLeft} ngày`, daysLeft < 0 ? HC.red : undefined],
                            ['Loại', kpi.category === 'Personal' ? 'Cá nhân' : 'Công việc'],
                        ].map(([k, v, color]) => (
                            <div className="ddb-drawer-meta-row" key={k}>
                                <span className="ddb-drawer-meta-key">{k}</span>
                                <span style={{ fontWeight: 600, fontSize: 12.5, color: color || 'var(--text)' }}>{v}</span>
                            </div>
                        ))}
                    </div>

                    {/* AI Coach */}
                    {health !== 'green' && (
                        <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
                                AI Coach
                            </div>
                            <CoachPanel kpi={kpi} lang={lang} onConfirmed={onReload} />
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}
