import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLang } from '../../LangContext'
import { UiIcon } from '../UiIcon'
import { captureScreen } from './captureScreen'
import { callVisionAPI, getVisionConfig } from './callVisionAPI'

const COOLDOWN_MS = 5000

const fallbackByPath = {
  '/dashboard': {
    screenKey: 'help.screen.dashboard',
    stepKeys: ['help.step.dashboard.1', 'help.step.dashboard.2', 'help.step.dashboard.3', 'help.step.dashboard.4'],
  },
  '/kpis': {
    screenKey: 'help.screen.kpis',
    stepKeys: ['help.step.kpis.1', 'help.step.kpis.2', 'help.step.kpis.3', 'help.step.kpis.4'],
  },
  '/chat': {
    screenKey: 'help.screen.chat',
    stepKeys: ['help.step.chat.1', 'help.step.chat.2', 'help.step.chat.3', 'help.step.chat.4'],
  },
  '/reports': {
    screenKey: 'help.screen.reports',
    stepKeys: ['help.step.reports.1', 'help.step.reports.2', 'help.step.reports.3', 'help.step.reports.4'],
  },
  '/journal': {
    screenKey: 'help.screen.journal',
    stepKeys: ['help.step.journal.1', 'help.step.journal.2', 'help.step.journal.3', 'help.step.journal.4'],
  },
  '/sources': {
    screenKey: 'help.screen.sources',
    stepKeys: ['help.step.sources.1', 'help.step.sources.2', 'help.step.sources.3', 'help.step.sources.4'],
  },
  '/settings': {
    screenKey: 'help.screen.settings',
    stepKeys: ['help.step.settings.1', 'help.step.settings.2', 'help.step.settings.3', 'help.step.settings.4'],
  },
}

function fallbackGuide(path, tr) {
  const base = fallbackByPath[path] || fallbackByPath['/dashboard']
  return {
    screen: tr(base.screenKey),
    summary: tr('help.fallback_summary'),
    issue: '',
    steps: base.stepKeys.map(k => tr(k)),
    tip: tr('help.fallback_tip'),
    source: 'fallback',
  }
}

const btnStyle = {
  position: 'fixed',
  right: 20,
  bottom: 22,
  zIndex: 900,
}

export default function HelpPanel({ targetRef, position = 'right', screenName }) {
  const { tr, lang } = useLang()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [guide, setGuide] = useState(null)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [lastRun, setLastRun] = useState(0)
  const [configured, setConfigured] = useState(null)

  useEffect(() => {
    getVisionConfig().then(cfg => setConfigured(Boolean(cfg.configured))).catch(() => setConfigured(false))
  }, [])

  const triggerStyle = useMemo(() => ({
    ...btnStyle,
    bottom: location.pathname === '/chat' ? 138 : btnStyle.bottom,
  }), [location.pathname])

  const panelStyle = useMemo(() => {
    const side = position === 'left' ? { left: 16 } : { right: 16 }
    return {
      position: 'fixed',
      top: 72,
      ...side,
      zIndex: 899,
      width: 'min(380px, calc(100vw - 32px))',
      maxHeight: 'calc(100vh - 100px)',
      overflow: 'auto',
      background: 'var(--grad-panel), var(--card)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      boxShadow: '0 24px 70px rgba(15,23,42,.28), 0 0 0 1px rgba(20,184,166,.05)',
      backdropFilter: 'blur(14px) saturate(140%)',
    }
  }, [position])

  const handleOpen = useCallback(async () => {
    const now = Date.now()
    if (loading || (now - lastRun < COOLDOWN_MS && guide)) {
      setIsOpen(true)
      return
    }
    setIsOpen(true)
    setLoading(true)
    setError(null)
    setGuide(null)
    setShowPreview(false)
    setLastRun(now)
    try {
      const target = targetRef?.current ?? document.body
      const base64Image = await captureScreen(target)
      setPreview(`data:image/png;base64,${base64Image}`)
      const visionReady = configured ?? Boolean((await getVisionConfig().catch(() => ({ configured: false }))).configured)
      setConfigured(visionReady)
      if (!visionReady) {
        setGuide(fallbackGuide(location.pathname, tr))
        return
      }
      const result = await callVisionAPI({
        base64Image,
        screenHint: screenName || location.pathname,
        lang,
      })
      setGuide(result)
    } catch (err) {
      const message = err.message || ''
      const isStyleCaptureIssue = /unsupported color function|html2canvas/i.test(message)
      setError(isStyleCaptureIssue ? null : (message.startsWith('help.') ? tr(message) : message || tr('help.error_generic')))
      setGuide(fallbackGuide(location.pathname, tr))
    } finally {
      setLoading(false)
    }
  }, [configured, guide, lang, lastRun, loading, location.pathname, screenName, targetRef, tr])

  function closePanel() {
    setIsOpen(false)
    setGuide(null)
    setError(null)
    setShowPreview(false)
  }

  return (
    <div data-help-ignore="true">
      <button
        type="button"
        className="help-panel-trigger"
        style={triggerStyle}
        onClick={isOpen ? closePanel : handleOpen}
        title={tr('help.open')}
        aria-label={tr('help.open')}
      >
        <span className="help-trigger-icon" aria-hidden="true"><UiIcon name={isOpen ? 'x' : 'helpCircle'} /></span>
        <span className="help-trigger-label">{tr('help.short_label')}</span>
      </button>

      {isOpen && (
        <section className="help-panel-drawer" style={panelStyle} aria-live="polite">
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--grad)', color: '#fff', fontWeight: 900 }}><UiIcon name="helpCircle" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: 'block', fontSize: 14 }}>{tr('help.title')}</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{tr('help.subtitle')}</span>
            </div>
            <button type="button" className="msg-tool" onClick={closePanel} aria-label={tr('common.cancel')}><UiIcon name="x" /></button>
          </div>

          <div style={{ padding: 16 }}>
            {loading && (
              <div style={{ padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 13 }}>
                {tr('help.loading')}
              </div>
            )}

            {error && (
              <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'rgba(220,38,38,.10)', border: '1px solid rgba(220,38,38,.30)', color: '#dc2626', fontSize: 13 }}>
                {error}
              </div>
            )}

            {guide && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <span style={{ display: 'inline-flex', padding: '3px 9px', borderRadius: 999, background: 'var(--grad-soft)', color: 'var(--primary)', fontSize: 12, fontWeight: 800 }}>
                    {guide.screen || tr('help.current_screen')}
                  </span>
                  <p style={{ marginTop: 8, color: 'var(--text)', fontSize: 14, lineHeight: 1.5 }}>{guide.summary}</p>
                </div>

                {guide.issue && (
                  <div style={{ padding: 11, borderRadius: 10, background: 'rgba(202,138,4,.12)', border: '1px solid rgba(202,138,4,.28)', color: '#a16207', fontSize: 13, lineHeight: 1.45 }}>
                    {guide.issue}
                  </div>
                )}

                <div>
                  <h3 style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{tr('help.steps_title')}</h3>
                  <ol style={{ display: 'grid', gap: 8, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                    {(guide.steps || []).map((step, idx) => <li key={`${idx}-${step}`}>{step}</li>)}
                  </ol>
                </div>

                {guide.tip && (
                  <div style={{ padding: 11, borderRadius: 10, background: 'rgba(22,163,74,.12)', border: '1px solid rgba(22,163,74,.26)', color: '#15803d', fontSize: 13, lineHeight: 1.45 }}>
                    {guide.tip}
                  </div>
                )}

                {guide.source === 'fallback' && (
                  <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.45 }}>
                    {tr('help.config_hint')}
                  </div>
                )}

                {preview && (
                  <button type="button" className="btn small" onClick={() => setShowPreview(v => !v)}>
                    <UiIcon name={showPreview ? 'eyeOff' : 'eye'} />{showPreview ? tr('help.hide_preview') : tr('help.show_preview')}
                  </button>
                )}
                {showPreview && preview && (
                  <img src={preview} alt={tr('help.preview_alt')} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />
                )}
                <button type="button" className="btn primary small" onClick={handleOpen} disabled={loading}>
                  <UiIcon name="refresh" />{tr('help.retry')}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
