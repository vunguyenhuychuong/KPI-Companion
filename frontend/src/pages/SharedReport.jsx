import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useLang } from '../LangContext'
import { UiIcon } from '../components/UiIcon'

const BASE = '/api'

async function fetchSharedReport(token) {
  const res = await fetch(`${BASE}/shared/${token}`)
  if (res.status === 410) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || 'shared.error_expired')
  }
  if (!res.ok) throw new Error(`shared.error_http:${res.status}`)
  return res.json()
}

function RingProgress({ value, size = 100, strokeWidth = 9 }) {
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, value))
  const color = pct >= 80 ? 'var(--sr-green)' : pct >= 50 ? 'var(--sr-yellow)' : 'var(--sr-red)'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
        strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(.4,0,.2,1)' }} />
    </svg>
  )
}

function StatusPill({ pct, tr }) {
  if (pct >= 80) return (
    <span style={{ background: 'rgba(34,197,94,.15)', color: 'var(--sr-green)', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{tr('shared.status_done')}</span>
  )
  if (pct >= 50) return (
    <span style={{ background: 'rgba(234,179,8,.15)', color: 'var(--sr-yellow)', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{tr('shared.status_improve')}</span>
  )
  return (
    <span style={{ background: 'rgba(239,68,68,.15)', color: 'var(--sr-red)', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{tr('shared.status_not_done')}</span>
  )
}

function Bar({ pct }) {
  const color = pct >= 80 ? 'var(--sr-green)' : pct >= 50 ? 'var(--sr-yellow)' : 'var(--sr-red)'
  return (
    <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 6, height: 7, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, transition: 'width .5s ease' }} />
    </div>
  )
}

function KpiRow({ kpi }) {
  const pct = Math.min(100, Math.round(kpi.progress))
  const color = pct >= 80 ? 'var(--sr-green)' : pct >= 50 ? 'var(--sr-yellow)' : 'var(--sr-red)'
  return (
    <div style={{ padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 5 }} />
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>{kpi.name}</span>
        <span style={{ fontSize: 13, color, fontWeight: 700, minWidth: 38, textAlign: 'right' }}>{pct}%</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 14 }}>
        <Bar pct={pct} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 90, textAlign: 'right' }}>
          {kpi.current_value}/{kpi.target_value} {kpi.unit}
        </span>
      </div>
    </div>
  )
}

const CSS = `
  :root {
    --sr-green: #22c55e;
    --sr-yellow: #eab308;
    --sr-red: #ef4444;
  }
  [data-theme="dark"] {
    --sr-green: #4ade80;
    --sr-yellow: #facc15;
    --sr-red: #f87171;
  }
  @keyframes sr-spin { to { transform: rotate(360deg) } }
  .sr-card {
    background: var(--grad-panel), var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(10px) saturate(140%);
    transition: border-color .2s;
  }
  .sr-stat-val { font-size: 26px; font-weight: 800; color: var(--primary); line-height: 1; }
  .sr-stat-lbl { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; margin-top: 3px; }
`

export default function SharedReport() {
  const { tr, lang } = useLang()
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    fetchSharedReport(token).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-muted)' }}>
      <style>{CSS}</style>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'sr-spin .7s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ fontSize: 14 }}>{tr('shared.loading')}</div>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <style>{CSS}</style>
      <div style={{ textAlign: 'center', maxWidth: 380, padding: '40px 24px' }}>
        <div className="shared-error-icon"><UiIcon name="link" /></div>
        <h2 style={{ color: 'var(--sr-red)', margin: '0 0 8px', fontSize: 20 }}>{tr('shared.link_unavailable')}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, lineHeight: 1.6 }}>
          {error === 'shared.error_expired' ? tr('shared.error_expired') : error.startsWith('shared.error_http:') ? tr('shared.error_http', { status: error.split(':')[1] }) : error}
        </p>
      </div>
    </div>
  )

  if (!data) return null

  const { cycle, objectives } = data
  const allKpis = objectives.flatMap(o => o.kpis)
  const totalKpis = allKpis.length
  const avgProgress = objectives.length
    ? Math.round(objectives.reduce((s, o) => s + o.progress, 0) / objectives.length)
    : 0
  const onTrack = objectives.filter(o => o.progress >= 80).length
  const atRisk = objectives.filter(o => o.progress >= 50 && o.progress < 80).length
  const behind = objectives.filter(o => o.progress < 50).length

  const expiresAt = new Date(data.share_link?.expires_at)
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US'
  const expiresStr = expiresAt.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const expiringSoon = (expiresAt - new Date()) / 86400000 <= 2

  const fmt = (d) => new Date(d).toLocaleDateString(locale)

  return (
    <div style={{ minHeight: '100vh', background: 'transparent', fontFamily: 'inherit', color: 'var(--text)' }}>
      <style>{CSS}</style>

      {/* ── Header ── */}
      <header style={{
        background: 'var(--grad)',
        color: '#fff', padding: '13px 24px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          fontWeight: 800, fontSize: 17,
          background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.3)',
          borderRadius: 10, width: 38, height: 38,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}>K</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>KPI Companion</div>
          <div style={{ fontSize: 11, opacity: .75, letterSpacing: .4 }}>{tr('shared.readonly_report')}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 11, opacity: .65 }}>{tr('shared.expires')}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: expiringSoon ? '#fde68a' : 'rgba(255,255,255,.95)' }}>
            {expiresStr} {expiringSoon && <span className="inline-ui-icon"><UiIcon name="warning" /></span>}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 48px' }}>

        {/* ── Hero: ring + cycle info + stats ── */}
        <div className="sr-card" style={{ padding: '22px 24px', marginBottom: 16, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>

          {/* Ring */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <RingProgress value={avgProgress} size={104} strokeWidth={10} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 21, fontWeight: 800, color: avgProgress >= 80 ? 'var(--sr-green)' : avgProgress >= 50 ? 'var(--sr-yellow)' : 'var(--sr-red)', lineHeight: 1 }}>{avgProgress}%</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3, letterSpacing: .5 }}>{tr('shared.progress')}</span>
            </div>
          </div>

          {/* Cycle info */}
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: 'var(--text)' }}>{cycle.name}</h1>
              {cycle.is_locked && (
                <span style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><UiIcon name="lock" /> {tr('cycle.locked_badge')}</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              {cycle.start_date && cycle.end_date ? `${fmt(cycle.start_date)} — ${fmt(cycle.end_date)}` : tr('shared.unspecified')}
            </div>

            {/* Status pills */}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {onTrack > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(34,197,94,.12)', color: 'var(--sr-green)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, border: '1px solid rgba(34,197,94,.25)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sr-green)', display: 'inline-block' }} />
                  {tr('shared.count_on_track', { count: onTrack })}
                </div>
              )}
              {atRisk > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(234,179,8,.12)', color: 'var(--sr-yellow)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, border: '1px solid rgba(234,179,8,.25)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sr-yellow)', display: 'inline-block' }} />
                  {tr('shared.count_improve', { count: atRisk })}
                </div>
              )}
              {behind > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(239,68,68,.12)', color: 'var(--sr-red)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, border: '1px solid rgba(239,68,68,.25)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sr-red)', display: 'inline-block' }} />
                  {tr('shared.count_not_done', { count: behind })}
                </div>
              )}
            </div>
          </div>

          {/* Stat counters */}
          <div style={{ display: 'flex', gap: 0, borderLeft: '1px solid var(--border)', marginLeft: 4, paddingLeft: 20, flexShrink: 0 }}>
            <div style={{ textAlign: 'center', padding: '0 16px', borderRight: '1px solid var(--border)' }}>
              <div className="sr-stat-val">{objectives.length}</div>
              <div className="sr-stat-lbl">{tr('shared.objectives')}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '0 16px' }}>
              <div className="sr-stat-val">{totalKpis}</div>
              <div className="sr-stat-lbl">KPI</div>
            </div>
          </div>
        </div>

        {/* ── Objective cards ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {objectives.map(obj => {
            const pct = Math.round(obj.progress)
            const accentColor = pct >= 80 ? 'var(--sr-green)' : pct >= 50 ? 'var(--sr-yellow)' : 'var(--sr-red)'
            return (
              <div key={obj.id} className="sr-card" style={{ overflow: 'hidden' }}>
                {/* Objective header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 20px', borderBottom: obj.kpis.length ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ width: 4, minHeight: 38, borderRadius: 4, background: accentColor, flexShrink: 0, alignSelf: 'stretch' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', flex: 1 }}>{obj.name}</span>
                      <StatusPill pct={pct} tr={tr} />
                      <span style={{ fontSize: 15, fontWeight: 800, color: accentColor, minWidth: 40, textAlign: 'right' }}>{pct}%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Bar pct={pct} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {obj.kpis.length} KPI
                        {obj.weight > 0 && ` · ${obj.weight}%`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* KPI rows */}
                {obj.kpis.length > 0 && (
                  <div style={{ padding: '0 20px 6px' }}>
                    {obj.kpis.map(kpi => <KpiRow key={kpi.id} kpi={kpi} />)}
                  </div>
                )}
                {obj.kpis.length === 0 && (
                  <div style={{ padding: '12px 20px 12px 36px', fontSize: 13, color: 'var(--text-muted)' }}>{tr('shared.no_kpis')}</div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Footer ── */}
        <div style={{ marginTop: 36, padding: '16px 0 0', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>K</div>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>KPI Companion</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('shared.footer_note')}</span>
        </div>
      </div>
    </div>
  )
}
