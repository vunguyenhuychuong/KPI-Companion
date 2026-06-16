import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'
import ProposalList from '../components/ProposalList'
import { UiIcon, cleanIconLabel } from '../components/UiIcon'

function lastMonday() {
  const d = new Date()
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

export default function Sources() {
  const { tr } = useLang()
  const sourceBadgeLabel = (mode) => (
    mode === 'real' ? tr('sources.real_badge')
      : mode === 'disconnected' ? tr('sources.disconnected_badge')
        : tr('sources.demo_badge')
  )

  const SOURCES = [
    { key: 'gmail', label: 'Gmail', icon: 'mail', descKey: 'sources.source_gmail_desc' },
    { key: 'calendar', label: 'Google Calendar', icon: 'calendar', descKey: 'sources.source_calendar_desc' },
    { key: 'sheets', label: 'Google Sheets', icon: 'table', descKey: 'sources.source_sheets_desc' },
    { key: 'notion', label: 'Notion', icon: 'note', descKey: 'sources.source_notion_desc' },
    { key: 'slack', label: 'Slack', icon: 'message', descKey: 'sources.source_slack_desc' },
    { key: 'outlook', label: 'Outlook', icon: 'mail', descKey: 'sources.source_outlook_desc' },
  ]

  const [status, setStatus] = useState(null)
  const [conn, setConn] = useState(null)
  const [integrations, setIntegrations] = useState([])
  const [connecting, setConnecting] = useState('')
  const [oauthMsg, setOauthMsg] = useState('')
  const [switching, setSwitching] = useState(false)
  const [selected, setSelected] = useState(['gmail', 'calendar', 'sheets'])
  const [start, setStart] = useState(lastMonday())
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const loadAll = () => {
    api.sourcesStatus().then(setStatus).catch(() => {})
    api.getConnectionSettings().then(setConn).catch(() => {})
    api.listIntegrations().then(setIntegrations).catch(() => {})
  }

  useEffect(() => {
    loadAll()
    // Doc ket qua tra ve sau khi OAuth redirect (?connected=google | ?oauth_error=...)
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const oauthError = params.get('oauth_error')
    if (connected) setOauthMsg(tr('integrations.success', { provider: connected }))
    else if (oauthError) setOauthMsg(tr('integrations.error', { error: oauthError }))
    if (connected || oauthError) {
      // don sach query string khoi URL
      window.history.replaceState({}, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connect = async (provider) => {
    setConnecting(provider)
    setError('')
    try {
      const { auth_url } = await api.startOAuth(provider)
      window.location.href = auth_url  // chuyen den trang dang nhap cua provider
    } catch (e) {
      setError(e.message)
      setConnecting('')
    }
  }

  const disconnect = async (provider) => {
    if (!window.confirm(tr('integrations.disconnect_confirm'))) return
    try {
      await api.disconnectIntegration(provider)
      loadAll()
    } catch (e) { setError(e.message) }
  }

  const switchMode = async (toMock) => {
    setSwitching(true)
    setError('')
    try {
      const res = await api.setConnectionSettings(toMock)
      setConn(res)
      const st = await api.sourcesStatus()
      setStatus(st)
    } catch (e) { setError(e.message) } finally { setSwitching(false) }
  }

  const toggle = (key) =>
    setSelected((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]))

  const sync = async () => {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await api.syncSources({ sources: selected, start_date: start, end_date: end })
      setResult(res)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await api.uploadWorklog(file)
      setResult(res)
    } catch (err) { setError(err.message) } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title-with-icon"><UiIcon name="link" /> {cleanIconLabel(tr('sources.title'))}</h1>
        <p>{tr('sources.subtitle')}</p>
      </header>

      {oauthMsg && <div className="mode-banner real">{oauthMsg}</div>}

      {status && (
        <div className={`mode-banner ${Object.values(status).includes('real') ? 'real' : 'mock'}`}>
          <span className="inline-ui-icon"><UiIcon name={Object.values(status).includes('real') ? 'checkCircle' : 'warning'} /></span>
          {Object.values(status).includes('real')
            ? cleanIconLabel(tr('sources.real_banner'))
            : cleanIconLabel(tr('sources.disconnected_banner', { note: status.note }))}
        </div>
      )}

      {/* ---- Ket noi tai khoan (OAuth) ---- */}
      <div className="card">
        <h3>{tr('integrations.section')}</h3>
        <p className="muted">{tr('integrations.desc')}</p>
        <div className="source-list">
          {integrations.map((it) => (
            <div key={it.provider} className={`source-item ${it.connected ? 'on' : ''}`}>
              <span className="source-icon" aria-hidden="true"><UiIcon name={it.provider === 'slack' ? 'message' : it.provider === 'notion' ? 'note' : it.provider === 'calendar' ? 'calendar' : it.provider === 'sheets' ? 'table' : 'mail'} /></span>
              <div style={{ flex: 1 }}>
                <div className="source-name">{it.label}</div>
                <div className="muted">
                  {it.connected
                    ? tr('integrations.connected_as', { email: it.account_email || it.account_name })
                    : tr('integrations.provides', { sources: it.sources.join(', ') })}
                </div>
              </div>
              {!it.enabled ? (
                <span className="badge mock">{tr('integrations.not_configured')}</span>
              ) : it.connected ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="badge real">{tr('integrations.connected')}</span>
                  <button className="btn" onClick={() => disconnect(it.provider)}>
                    <UiIcon name="x" />{tr('integrations.disconnect')}
                  </button>
                </div>
              ) : (
                <button
                  className="btn primary"
                  onClick={() => connect(it.provider)}
                  disabled={connecting === it.provider}
                >
                  <UiIcon name="link" />{connecting === it.provider ? tr('integrations.connecting') : cleanIconLabel(tr('integrations.connect'))}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{tr('sources.google_section')}</h3>

        {conn && (
          <div className="conn-config">
            <div className="conn-config-head">
              <span className="setting-label">{tr('sources.conn_mode')}</span>
              <div className="seg">
                <button className={`seg-btn ${conn.google_mock_mode ? 'active' : ''}`}
                  onClick={() => !conn.google_mock_mode && switchMode(true)} disabled={switching}>
                  <UiIcon name="bot" />{tr('sources.mode_mock')}
                </button>
                <button className={`seg-btn ${!conn.google_mock_mode ? 'active' : ''}`}
                  onClick={() => conn.google_mock_mode && switchMode(false)} disabled={switching}>
                  <UiIcon name="link" />{tr('sources.mode_real')}
                </button>
              </div>
              <span className={`badge ${conn.effective_mode}`}>
                {conn.effective_mode === 'real' ? tr('sources.real_badge') : tr('sources.demo_badge')}
              </span>
            </div>
            <p className="muted conn-note">{switching ? tr('sources.switching') : conn.note}</p>
          </div>
        )}

        <div className="source-list">
          {SOURCES.map((s) => (
            <label key={s.key} className={`source-item ${selected.includes(s.key) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected.includes(s.key)} onChange={() => toggle(s.key)} />
              <span className="source-icon" aria-hidden="true"><UiIcon name={s.icon} /></span>
              <div>
                <div className="source-name">{s.label}</div>
                <div className="muted">{tr(s.descKey)}</div>
              </div>
              {status && (
                <span className={`badge ${status[s.key]}`}>
                  {sourceBadgeLabel(status[s.key])}
                </span>
              )}
            </label>
          ))}
        </div>
        <div className="form-row">
          <label>{tr('sources.from_date')} <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>{tr('sources.to_date')} <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <button className="btn primary" onClick={sync} disabled={busy || selected.length === 0}>
            <UiIcon name="scan" />
            {busy ? tr('sources.scanning') : cleanIconLabel(tr('sources.scan_btn'))}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="icon-heading"><UiIcon name="upload" /> {tr('sources.upload_section')}</h3>
        <p className="muted">{tr('sources.upload_desc')}</p>
        <button className="btn import-cta" onClick={() => fileRef.current?.click()} disabled={busy}>
          <UiIcon name="upload" />
          {cleanIconLabel(tr('sources.upload_btn'))}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={upload} />
      </div>

      {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}

      {result && (
        <div className="card">
          <p>{result.reply}</p>
          {result.proposed_items?.length > 0 ? (
            <ProposalList
              items={result.proposed_items}
              onConfirmed={() => setResult({ ...result, proposed_items: [], reply: tr('sources.success') })}
              onDismiss={() => setResult(null)}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
