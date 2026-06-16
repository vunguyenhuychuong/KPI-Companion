import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'
import { useLang } from '../LangContext'
import ProposalList from './ProposalList'
import { useToast } from './Toast'
import { UiIcon, cleanIconLabel } from './UiIcon'

function itemTitle(item) {
  if (item.summary) return item.summary
  return String(item.content || '')
    .split('\n')[0]
    .replace(/\*/g, '')
    .replace(/^Agent tự chủ phát hiện:\s*/i, '')
    .replace(/^Autonomous Agent detected:\s*/i, '')
    .trim()
}

function categoryLabel(category, tr) {
  return cleanIconLabel(category === 'Personal' ? tr('category.personal') : tr('category.work'))
}

export default function AutonomousAgentInbox() {
  const { tr, lang } = useLang()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)
  const loadedOnce = useRef(false)
  const knownIds = useRef(new Set())

  const load = async (scan = false, autoOpen = false) => {
    setLoading(true)
    setError('')
    try {
      const data = scan ? await api.refreshAutonomousAgentInbox() : await api.autonomousAgentInbox()
      const ids = new Set((data || []).map((item) => item.message_id))
      const hasNew = (data || []).some((item) => !knownIds.current.has(item.message_id))
      setItems(data || [])
      if ((autoOpen || (loadedOnce.current && hasNew)) && data?.length) setOpen(true)
      knownIds.current = ids
      loadedOnce.current = true
    } catch (e) {
      setError(e.message || tr('agent_inbox.error'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(true, true)
    const t = setInterval(() => load(true, false), 5 * 60 * 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const mark = async (item, status, messageKey) => {
    try {
      await api.setProposalStatus(item.message_id, status)
      setItems((prev) => prev.filter((x) => x.message_id !== item.message_id))
      toast.success(tr(messageKey))
    } catch (e) {
      toast.error(e.message)
    }
  }

  const confirmCategorySuggestion = async (item, suggestion) => {
    try {
      const target = suggestion.suggested_category
      await api.updateKpi(suggestion.kpi_id, {
        category: target,
        reason: tr('agent_inbox.category_change_reason', { reason: suggestion.reason || '' }),
      })
      await mark(item, 'saved', 'agent_inbox.category_confirmed')
    } catch (e) {
      toast.error(e.message)
    }
  }

  const count = items.length

  return (
    <div className="agent-inbox-wrap" ref={ref}>
      <button
        className={`agent-inbox-trigger${count ? ' has-items' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={tr('agent_inbox.open')}
        aria-label={tr('agent_inbox.open')}
      >
        <UiIcon name="bot" />
        {count > 0 && <span className="notif-badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="agent-inbox-panel">
          <div className="agent-inbox-head">
            <div>
              <strong>{tr('agent_inbox.title')}</strong>
              <span>{count ? tr('agent_inbox.pending_count', { count }) : tr('agent_inbox.empty')}</span>
            </div>
            <button
              className="agent-inbox-refresh"
              onClick={() => load(true, false)}
              disabled={loading}
              title={tr('agent_inbox.refresh')}
            >
              <UiIcon name="refresh" />{loading ? tr('agent_inbox.refreshing') : tr('agent_inbox.refresh')}
            </button>
          </div>
          {error && <div className="agent-inbox-error">{error}</div>}
          {!count && !error && <div className="agent-inbox-empty">{tr('agent_inbox.empty')}</div>}
          {items.map((item) => (
            <div className="agent-inbox-item" key={item.message_id}>
              <div className="agent-inbox-item-head">
                <span className="agent-inbox-icon"><UiIcon name="sparkles" /></span>
                <div>
                  <strong>{itemTitle(item)}</strong>
                  <span>{new Date(item.created_at).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')}</span>
                </div>
              </div>
              <div className="agent-inbox-copy" dangerouslySetInnerHTML={{ __html: marked.parse(item.content || '') }} />
              <div className="agent-inbox-ready">
                {item.event_type === 'source_scan' ? tr('agent_inbox.source_scan_ready') : tr('agent_inbox.ready')}
              </div>
              {item.proposed_items?.length > 0 && (
                <ProposalList
                  items={item.proposed_items}
                  onConfirmed={() => mark(item, 'saved', 'agent_inbox.confirmed')}
                  onDismiss={() => mark(item, 'dismissed', 'agent_inbox.dismissed')}
                />
              )}
              {item.category_suggestions?.map((suggestion) => (
                <div className="agent-category-card" key={`${item.message_id}-${suggestion.kpi_id}`}>
                  <div className="agent-category-top">
                    <span className="agent-category-icon"><UiIcon name="arrowRight" /></span>
                    <div>
                      <strong>{suggestion.kpi_name}</strong>
                      <span>
                        {categoryLabel(suggestion.current_category, tr)}
                        {' -> '}
                        {categoryLabel(suggestion.suggested_category, tr)}
                      </span>
                    </div>
                  </div>
                  {suggestion.reason && <p>{suggestion.reason}</p>}
                  <div className="agent-category-meta">
                    {tr('agent_inbox.category_confidence', {
                      value: Math.round(Number(suggestion.confidence || 0) * 100),
                    })}
                  </div>
                  <div className="proposal-actions">
                    <button className="btn primary" onClick={() => confirmCategorySuggestion(item, suggestion)}>
                      <UiIcon name="check" />
                      {tr('agent_inbox.category_confirm', {
                        category: categoryLabel(suggestion.suggested_category, tr),
                      })}
                    </button>
                    <button className="btn ghost" onClick={() => mark(item, 'dismissed', 'agent_inbox.dismissed')}>
                      <UiIcon name="x" />{tr('agent_inbox.category_dismiss')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
