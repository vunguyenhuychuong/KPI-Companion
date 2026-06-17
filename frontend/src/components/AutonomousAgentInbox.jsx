import { useCallback, useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'
import { useLang } from '../LangContext'
import { prefs } from '../prefs'
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

function messageIds(items) {
  return (items || [])
    .map((item) => String(item.message_id || ''))
    .filter(Boolean)
}

export default function AutonomousAgentInbox() {
  const { tr, lang } = useLang()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [unseenCount, setUnseenCount] = useState(0)
  const ref = useRef(null)
  const itemsRef = useRef([])
  const openRef = useRef(false)

  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { openRef.current = open }, [open])

  const markSeen = useCallback((sourceItems = itemsRef.current) => {
    const ids = messageIds(sourceItems)
    if (!ids.length) {
      setUnseenCount(0)
      return
    }
    const seen = new Set(prefs.getAgentInboxSeenIds().map(String))
    ids.forEach((id) => seen.add(id))
    prefs.setAgentInboxSeenIds([...seen])
    setUnseenCount(0)
  }, [])

  const openPanel = useCallback(() => {
    markSeen()
    setOpen(true)
  }, [markSeen])

  const closePanel = useCallback(() => {
    prefs.setAgentInboxAutoOpenDismissed(true)
    markSeen()
    setOpen(false)
  }, [markSeen])

  const load = async (scan = false, autoOpen = false) => {
    setLoading(true)
    setError('')
    try {
      const data = scan ? await api.refreshAutonomousAgentInbox() : await api.autonomousAgentInbox()
      const rows = data || []
      const ids = messageIds(rows)
      const seen = new Set(prefs.getAgentInboxSeenIds().map(String))
      const unseen = ids.filter((id) => !seen.has(id))
      const shouldAutoOpen = Boolean(
        rows.length &&
        autoOpen &&
        !prefs.getAgentInboxAutoOpened() &&
        !prefs.getAgentInboxAutoOpenDismissed()
      )
      setItems(rows)
      if (openRef.current || shouldAutoOpen) {
        ids.forEach((id) => seen.add(id))
        prefs.setAgentInboxSeenIds([...seen])
        setUnseenCount(0)
      } else {
        setUnseenCount(unseen.length)
      }
      if (shouldAutoOpen) {
        prefs.setAgentInboxAutoOpened(true)
        setOpen(true)
      }
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
    const h = (e) => {
      if (openRef.current && ref.current && !ref.current.contains(e.target)) closePanel()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [closePanel])

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
        className={`agent-inbox-trigger${count ? ' has-items' : ''}${unseenCount ? ' has-unseen' : ''}`}
        onClick={() => (open ? closePanel() : openPanel())}
        title={tr('agent_inbox.open')}
        aria-label={tr('agent_inbox.open')}
        aria-expanded={open}
        aria-haspopup="dialog"
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
            <div className="agent-inbox-head-actions">
              <button
                className="agent-inbox-refresh"
                type="button"
                onClick={() => load(true, false)}
                disabled={loading}
                title={tr('agent_inbox.refresh')}
              >
                <UiIcon name="refresh" />{loading ? tr('agent_inbox.refreshing') : tr('agent_inbox.refresh')}
              </button>
              <button
                className="agent-inbox-close"
                type="button"
                onClick={closePanel}
                title={tr('common.close')}
                aria-label={tr('common.close')}
              >
                <UiIcon name="x" />
              </button>
            </div>
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
              {!item.proposed_items?.length && !item.category_suggestions?.length && (
                <div className="proposal-actions">
                  <button className="btn primary" onClick={() => mark(item, 'saved', 'agent_inbox.insight_confirmed')}>
                    <UiIcon name="check" />{tr('agent_inbox.insight_useful')}
                  </button>
                  <button className="btn ghost" onClick={() => mark(item, 'dismissed', 'agent_inbox.dismissed')}>
                    <UiIcon name="x" />{tr('agent_inbox.category_dismiss')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
