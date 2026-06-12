import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'
import { useLang } from '../LangContext'
import ProposalList from '../components/ProposalList'
import KpiProposal from '../components/KpiProposal'

function Message({ msg, onConfirmed, onEdit, onResend, tr }) {
    const html = { __html: marked.parse(msg.content || '') }
    return (
        <div className={`msg ${msg.role}`}>
            <div className="msg-avatar">{msg.role === 'user' ? '🧑' : '🤖'}</div>
            <div className="msg-body">
                <div className="msg-content" dangerouslySetInnerHTML={html} />
                {msg.role === 'user' && (
                    <div className="msg-tools">
                        <button className="msg-tool" title={tr('chat.edit_title')} onClick={() => onEdit(msg.content)}>{tr('chat.edit_btn')}</button>
                        <button className="msg-tool" title={tr('chat.resend_title')} onClick={() => onResend(msg.content)}>{tr('chat.resend_btn')}</button>
                    </div>
                )}
                {msg.duration != null && (
                    <div className="msg-duration">{tr('chat.response_time', { secs: msg.duration })}</div>
                )}
                {msg.proposed_items?.length > 0 && !msg.confirmed && (
                    <ProposalList
                        items={msg.proposed_items}
                        onConfirmed={() => onConfirmed(msg)}
                        onDismiss={() => onConfirmed(msg, true)}
                    />
                )}
                {msg.proposed_kpis?.length > 0 && !msg.confirmed && (
                    <KpiProposal
                        kpis={msg.proposed_kpis}
                        weightChanges={msg.weight_changes}
                        onConfirmed={() => onConfirmed(msg)}
                        onDismiss={() => onConfirmed(msg, true)}
                    />
                )}
                {msg.confirmed === 'saved' && (
                    <div className="confirmed-note">{tr('chat.saved')}</div>
                )}
                {msg.confirmed === 'dismissed' && <div className="confirmed-note muted">{tr('chat.dismissed')}</div>}
            </div>
        </div>
    )
}

function Thinking({ tr }) {
    const [secs, setSecs] = useState(0)
    useEffect(() => {
        const t = setInterval(() => setSecs((s) => s + 1), 1000)
        return () => clearInterval(t)
    }, [])
    return (
        <div className="msg assistant">
            <div className="msg-avatar">🤖</div>
            <div className="msg-body">
                <div className="typing">
                    <span className="typing-dots"><span></span><span></span><span></span></span>
                    {tr('chat.thinking')} <b>{secs}s</b>
                    {secs >= 30 && <span className="typing-slow"> {tr('chat.slow_warning')}</span>}
                </div>
            </div>
        </div>
    )
}

export default function Chat() {
    const { tr, lang } = useLang()
    const SUGGESTIONS = [
        tr('chat.sug_1'),
        tr('chat.sug_2'),
        tr('chat.sug_3'),
        tr('chat.sug_4'),
    ]

    const [sessions, setSessions] = useState([])
    const [activeId, setActiveId] = useState(null)
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [busy, setBusy] = useState(false)
    const bottomRef = useRef(null)
    const inputRef = useRef(null)

    const loadSessions = () => api.chatSessions().then(setSessions).catch(() => {})
    useEffect(() => { loadSessions() }, [])

    const openSession = async (id) => {
        setActiveId(id)
        if (id === null) { setMessages([]); return }
        const history = await api.chatHistory(id).catch(() => [])
        setMessages(
            history.map((m) => ({
                role: m.role,
                content: m.content,
                proposed_items: m.meta?.proposed_items || [],
                proposed_kpis: m.meta?.proposed_kpis || [],
                weight_changes: m.meta?.weight_changes || [],
                confirmed: 'history',
            })),
        )
    }

    useEffect(() => {
        api.chatSessions().then((list) => {
            setSessions(list)
            if (list.length > 0) openSession(list[0].id)
        }).catch(() => {})
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, busy])

    const newChat = () => {
        setActiveId(null)
        setMessages([])
        inputRef.current?.focus()
    }

    const removeSession = async (e, id) => {
        e.stopPropagation()
        if (!confirm(tr('chat.delete_confirm'))) return
        await api.deleteChatSession(id)
        if (id === activeId) newChat()
        loadSessions()
    }

    const send = async (text) => {
        const message = (text ?? input).trim()
        if (!message || busy) return
        setInput('')
        setMessages((m) => [...m, { role: 'user', content: message }])
        setBusy(true)
        const started = Date.now()
        try {
            const res = await api.sendChat(message, activeId, lang)
            const duration = Math.round((Date.now() - started) / 10) / 100
            if (res.session_id && res.session_id !== activeId) {
                setActiveId(res.session_id)
                loadSessions()
            }
            setMessages((m) => [
                ...m,
                {
                    role: 'assistant',
                    content: res.reply,
                    proposed_items: res.proposed_items || [],
                    proposed_kpis: res.proposed_kpis || [],
                    weight_changes: res.weight_changes || [],
                    duration,
                },
            ])
        } catch (e) {
            const msg = e.name === 'AbortError'
                ? tr('chat.timeout_error')
                : tr('chat.error_prefix', { message: e.message })
            setMessages((m) => [...m, { role: 'assistant', content: msg }])
        } finally {
            setBusy(false)
        }
    }

    const editMessage = (content) => {
        setInput(content)
        inputRef.current?.focus()
    }

    const markConfirmed = (msg, dismissed = false) => {
        setMessages((all) =>
            all.map((m) => (m === msg ? { ...m, confirmed: dismissed ? 'dismissed' : 'saved' } : m)),
        )
    }

    return (
        <div className="chat-layout">
            <aside className="chat-sessions">
                <button className="btn primary new-chat-btn" onClick={newChat}>{tr('chat.new_session')}</button>
                <div className="session-list">
                    {sessions.map((s) => (
                        <div
                            key={s.id}
                            className={`session-item ${s.id === activeId ? 'active' : ''}`}
                            onClick={() => openSession(s.id)}
                            title={s.title}
                        >
                            <span className="session-title">{s.title}</span>
                            <span className="session-date">{s.created_at?.slice(0, 16).replace('T', ' ')}</span>
                            <button className="btn-icon session-del" title={tr('chat.delete_session')} onClick={(e) => removeSession(e, s.id)}>✕</button>
                        </div>
                    ))}
                    {sessions.length === 0 && <p className="muted session-empty">{tr('chat.no_sessions')}</p>}
                </div>
            </aside>

            <div className="chat-page">
                <header className="page-header">
                    <h1>{tr('chat.title')}</h1>
                    <p>{tr('chat.subtitle')}</p>
                </header>
                <div className="chat-messages">
                    {messages.length === 0 && (
                        <div className="chat-empty">
                            <h3>{tr('chat.greeting')}</h3>
                            <p>{tr('chat.try_these')}</p>
                            <div className="suggestions">
                                {SUGGESTIONS.map((s) => (
                                    <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>
                                ))}
                            </div>
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <Message key={i} msg={m} onConfirmed={markConfirmed} onEdit={editMessage} onResend={send} tr={tr} />
                    ))}
                    {busy && <Thinking tr={tr} />}
                    <div ref={bottomRef} />
                </div>
                <div className="chat-input">
                    <textarea
                        ref={inputRef}
                        rows={2}
                        placeholder={tr('chat.input_placeholder')}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                send()
                            }
                        }}
                    />
                    <button className="btn primary" onClick={() => send()} disabled={busy || !input.trim()}>
                        {tr('chat.send_btn')}
                    </button>
                </div>
            </div>
        </div>
    )
}
