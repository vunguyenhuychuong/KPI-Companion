import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLang } from '../LangContext'
import { useToast } from './Toast'
import { loadSupportConfig } from '../supportConfig'
import { UiIcon } from './UiIcon'

const MAX_DESCRIPTION = 500

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

const SUPPORT_ICON = (
  <Icon>
    <path d="M4 13a8 8 0 0 1 16 0" />
    <path d="M4 13v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2Z" />
    <path d="M20 13v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2Z" />
    <path d="M13 20h2a3 3 0 0 0 3-3" />
  </Icon>
)

const MAIL_ICON = (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Icon>
)

const CLOSE_ICON = (
  <Icon>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
)

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map(part => part[0])
    .join('')
    .toUpperCase()
}

function telHref(phone = '') {
  const normalized = phone.replace(/[^\d+]/g, '')
  return normalized ? `tel:${normalized}` : undefined
}

function encodeRecipients(value = '') {
  return value
    .split(/[;,]/)
    .map(email => email.trim())
    .filter(Boolean)
    .map(email => encodeURIComponent(email))
    .join(',')
}

function buildMailto({ config, user, description, labels, locale }) {
  const senderName = user?.name || ''
  const senderEmail = user?.email || ''
  const body = [
    `${labels.description}:`,
    description.trim(),
    '',
    `${labels.sender}:`,
    `- ${labels.name}: ${senderName || labels.empty}`,
    `- ${labels.email}: ${senderEmail || labels.empty}`,
    `- ${labels.time}: ${new Date().toLocaleString(locale)}`,
  ].join('\n')

  const to = encodeRecipients(config.supportEmail || config.admins.map(a => a.email).join(','))
  const subject = encodeURIComponent(config.subject)
  return `mailto:${to}?subject=${subject}&body=${encodeURIComponent(body)}`
}

function buildGmailCompose({ config, user, description, labels, locale }) {
  const senderName = user?.name || ''
  const senderEmail = user?.email || ''
  const body = [
    `${labels.description}:`,
    description.trim(),
    '',
    `${labels.sender}:`,
    `- ${labels.name}: ${senderName || labels.empty}`,
    `- ${labels.email}: ${senderEmail || labels.empty}`,
    `- ${labels.time}: ${new Date().toLocaleString(locale)}`,
  ].join('\n')
  const to = config.supportEmail || config.admins.map(a => a.email).join(',')
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    tf: '1',
    to,
    su: config.subject,
    body,
  })
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(senderEmail)}&${params.toString()}`
}

export default function SupportPanel({ user }) {
  const { tr, lang } = useLang()
  const location = useLocation()
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [config, setConfig] = useState(null)
  const [description, setDescription] = useState('')
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || config || loadingConfig) return
    setLoadingConfig(true)
    loadSupportConfig()
      .then(({ config: nextConfig, usedFallback }) => {
        setConfig(nextConfig)
        if (usedFallback) toast.info(tr('support.config_error'))
      })
      .finally(() => setLoadingConfig(false))
  }, [config, isOpen, loadingConfig, toast, tr])

  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  const sender = useMemo(() => {
    const label = [user?.name, user?.email].filter(Boolean).join(' · ')
    return label || tr('support.sender_unknown')
  }, [tr, user?.email, user?.name])

  const supportConfig = config || {
    admins: [],
    subject: '[KPI Companion] Yêu cầu hỗ trợ kỹ thuật',
    supportEmail: '',
    slackEnabled: false,
    slackChannel: '#kpi-support',
  }
  const isGoogleMailUser = user?.auth_provider === 'google' && Boolean(user?.email)
  const triggerStyle = location.pathname === '/chat' ? { bottom: 198 } : undefined

  function closePanel() {
    setIsOpen(false)
    setError('')
  }

  function handleDescriptionChange(event) {
    setDescription(event.target.value.slice(0, MAX_DESCRIPTION))
    setError('')
  }

  function handleSendEmail() {
    const trimmed = description.trim()
    if (!trimmed) {
      setError(tr('support.blank_error'))
      return
    }
    setSending(true)
    setError('')
    try {
      const payload = {
        config: supportConfig,
        user,
        description: trimmed,
        locale: lang === 'vi' ? 'vi-VN' : 'en-US',
        labels: {
          description: tr('support.mail_body_description'),
          sender: tr('support.mail_body_sender'),
          name: tr('support.mail_body_name'),
          email: tr('support.mail_body_email'),
          time: tr('support.mail_body_time'),
          empty: tr('support.mail_body_empty'),
        },
      }
      const url = isGoogleMailUser ? buildGmailCompose(payload) : buildMailto(payload)
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (!opened) window.location.href = url
      toast.success(isGoogleMailUser ? tr('support.gmail_opened') : tr('support.email_opened'))
      setDescription('')
      closePanel()
    } catch {
      const message = tr('support.email_error')
      setError(message)
      toast.error(message)
    } finally {
      setSending(false)
    }
  }

  function handleSlack() {
    toast.info(tr('support.slack_unavailable'))
  }

  return (
    <div className="support-panel-root" data-help-ignore="true">
      <button
        type="button"
        className="support-panel-trigger"
        style={triggerStyle}
        onClick={() => setIsOpen(v => !v)}
        title={tr('support.open')}
        aria-label={tr('support.open')}
      >
        <span className="support-trigger-icon">{isOpen ? CLOSE_ICON : SUPPORT_ICON}</span>
        <span className="support-trigger-label">{tr('support.short_label')}</span>
      </button>

      {isOpen && (
        <section className="support-panel-drawer" aria-live="polite">
          <div className="support-panel-head">
            <div className="support-panel-mark">{SUPPORT_ICON}</div>
            <div>
              <strong>{tr('support.title')}</strong>
              <span>{tr('support.subtitle')}</span>
            </div>
            <button type="button" className="support-icon-btn" onClick={closePanel} aria-label={tr('common.close')}>
              {CLOSE_ICON}
            </button>
          </div>

          <div className="support-panel-body">
            <section className="support-section">
              <h3>{tr('support.contacts')}</h3>
              {loadingConfig && <div className="support-loading">{tr('common.loading')}</div>}
              <div className="support-admin-list">
                {supportConfig.admins.map((admin) => (
                  <article className="support-admin-card" key={`${admin.domain}-${admin.email}`}>
                    <div className="support-admin-avatar" aria-hidden="true">{initials(admin.name)}</div>
                    <div className="support-admin-main">
                      <div className="support-admin-title">
                        <strong>{admin.name}</strong>
                        {admin.domain && <span>{admin.domain}</span>}
                      </div>
                      <dl className="support-admin-meta">
                        <div>
                          <dt>{tr('support.phone')}</dt>
                          <dd>{admin.phone ? <a href={telHref(admin.phone)}>{admin.phone}</a> : '-'}</dd>
                        </div>
                        <div>
                          <dt>{tr('support.email')}</dt>
                          <dd><a href={`mailto:${admin.email}`}>{admin.email}</a></dd>
                        </div>
                        <div>
                          <dt>{tr('support.hours')}</dt>
                          <dd>{admin.hours || '-'}</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="support-section">
              <h3>{tr('support.request')}</h3>
              <div className="support-form-grid">
                <div className="support-readonly-field">
                  <span>{tr('support.subject')}</span>
                  <strong>{supportConfig.subject}</strong>
                </div>
                <div className="support-readonly-field">
                  <span>{tr('support.sender')}</span>
                  <strong>{sender}</strong>
                </div>
                <label className="field-label" htmlFor="support-description">{tr('support.description')}</label>
                <textarea
                  id="support-description"
                  className="input support-textarea"
                  value={description}
                  onChange={handleDescriptionChange}
                  maxLength={MAX_DESCRIPTION}
                  placeholder={tr('support.description_ph')}
                />
                <div className="support-form-footer">
                  <span className="support-char-count">{tr('support.char_count', { count: description.length })}</span>
                  {error && <span className="form-msg">{error}</span>}
                </div>
              </div>
              <div className="support-actions">
                <button type="button" className="btn primary" onClick={handleSendEmail} disabled={sending || loadingConfig}>
                  <span className="support-btn-icon">{MAIL_ICON}</span>
                  {sending ? tr('support.sending') : (isGoogleMailUser ? tr('support.send_gmail') : tr('support.send_email'))}
                </button>
                <button type="button" className="btn" onClick={closePanel}><UiIcon name="x" />{tr('support.cancel')}</button>
              </div>
              {supportConfig.slackEnabled && (
                <button type="button" className="btn small support-slack-btn" onClick={handleSlack}>
                  <UiIcon name="message" />{tr('support.slack')} · {supportConfig.slackChannel}
                </button>
              )}
            </section>
          </div>
        </section>
      )}
    </div>
  )
}
