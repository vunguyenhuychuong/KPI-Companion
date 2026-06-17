import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import { api } from '../api'
import { useLang } from '../LangContext'
import ProposalList from './ProposalList'
import { UiIcon, cleanIconLabel } from './UiIcon'

const HC = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' }

function CoachPanel({ kpi, lang, onConfirmed }) {
    const { tr } = useLang()
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
                <UiIcon name="compass" />{loading ? tr('dashboard.coach_loading', { secs }) : open ? tr('dashboard.coach_hide') : cleanIconLabel(tr('dashboard.coach_btn'))}
            </button>
            {open && (
                <div className="coach-panel">
                    {err && <p className="error-text"><UiIcon name="warning" /> {err}</p>}
                    {data && !loading && (
                        <>
                            <div className="coach-analysis" dangerouslySetInnerHTML={{ __html: marked.parse(data.analysis || '') }} />
                            {data.root_causes?.length > 0 && (
                                <div className="coach-causes">
                                    <strong>{tr('dashboard.coach_causes_title')}</strong>
                                    <ul>{data.root_causes.map((c, i) => (
                                        <li key={i}>{c.cause}{c.question && <em> — {c.question}</em>}</li>
                                    ))}</ul>
                                </div>
                            )}
                            {data.proposed_items?.length > 0 && (
                                <>
                                    <strong className="coach-actions-title">{tr('dashboard.coach_actions_title')}</strong>
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

export default function KpiDetailDrawer({ item, year, onClose, onReload, lang, onBack, backLabel }) {
    const { tr } = useLang()
    const drawerRef = useRef(null)
    const { kpi, expected_progress, health, gap } = item
    const c = HC[health]
    const r = 44, circum = 2 * Math.PI * r
    const filled = (Math.min(100, kpi.progress) / 100) * circum
    const dl = kpi.deadline || `${year}-12-31`
    const daysLeft = Math.ceil((new Date(dl) - new Date()) / 86400000)

    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        document.body.classList.add('kpi-drawer-open')
        document.body.style.overflow = 'hidden'
        requestAnimationFrame(() => {
            const drawer = drawerRef.current
            drawer?.querySelector('.ddb-drawer-body')?.scrollTo({ top: 0, left: 0 })
            drawer?.focus()
        })
        return () => {
            window.removeEventListener('keydown', onKey)
            document.body.classList.remove('kpi-drawer-open')
            document.body.style.overflow = ''
        }
    }, [onClose])

    const drawer = (
        <>
            <div className="ddb-backdrop" onClick={onClose} />
            <div className="ddb-drawer" role="dialog" aria-modal="true" aria-label={kpi.name} tabIndex={-1} ref={drawerRef}>
                {/* Header */}
                <div className="ddb-drawer-hd">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {onBack && (
                            <button
                                className="btn small ghost"
                                type="button"
                                onClick={onBack}
                                style={{ marginBottom: 10, paddingInline: 0, color: 'var(--muted)' }}
                            >
                                <UiIcon name="arrowLeft" />{backLabel || tr('common.back')}
                            </button>
                        )}
                        <div className="ddb-drawer-title">{kpi.name}</div>
                        {kpi.objective_name && (
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.35 }}>
                                <span className="inline-ui-icon"><UiIcon name="flag" /></span> {kpi.objective_name}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: c + '22', color: c }}>
                            {kpi.progress > 100 ? tr('kpi_detail.over_target') : tr(`dashboard.health_${health}`)}
                        </span>
                        <button className="btn-icon" onClick={onClose} title={tr('common.cancel')}><UiIcon name="x" /></button>
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
                                <span style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{tr('kpi_detail.progress')}</span>
                            </div>
                        </div>

                        <div className="ddb-drawer-stats">
                            {[
                                [tr('kpi_detail.actual'), `${kpi.current_value} ${kpi.unit}`],
                                [tr('kpi_detail.target'), `${kpi.target_value} ${kpi.unit}`],
                                [tr('kpi_detail.expected'), `${expected_progress}%`],
                                [tr('kpi_detail.gap'), `${gap > 0 ? '+' : ''}${gap}%`, c],
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
                            }} title={tr('kpi_detail.expected_title', { progress: expected_progress })} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
                            <span>{tr('kpi_detail.actual')} <b style={{ color: 'var(--text)' }}>{kpi.progress}%</b></span>
                            <span>{tr('kpi_detail.expected')} <b style={{ color: 'var(--text)' }}>{expected_progress}%</b></span>
                        </div>
                    </div>

                    {/* Meta table */}
                    <div className="ddb-drawer-meta">
                        {[
                            [tr('kpi_detail.weight'), `${kpi.weight}%`],
                            [tr('kpis.deadline_label'), dl, daysLeft < 0 ? HC.red : daysLeft < 30 ? HC.yellow : undefined],
                            [tr('kpi_detail.remaining'), daysLeft >= 0 ? tr('kpi_detail.days', { days: daysLeft }) : tr('kpi_detail.overdue_days', { days: -daysLeft }), daysLeft < 0 ? HC.red : undefined],
                            [tr('kpi_detail.category'), kpi.category === 'Personal' ? tr('category.personal') : tr('category.work')],
                            [tr('input.cadence'), tr(`input.cadence_${kpi.cadence || 'monthly'}`)],
                            [tr('input.data_source_mode'), tr(`input.source_${kpi.data_source_mode || 'manual'}`)],
                            [tr('input.warning_short'), `${kpi.warning_threshold ?? 80}%`],
                            [tr('input.critical_short'), `${kpi.critical_threshold ?? 70}%`],
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
                                {tr('dashboard.coach_btn')}
                            </div>
                            <CoachPanel kpi={kpi} lang={lang} onConfirmed={onReload} />
                        </div>
                    )}
                </div>
            </div>
        </>
    )
    return createPortal(drawer, document.body)
}
