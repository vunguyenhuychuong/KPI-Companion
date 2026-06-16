import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'
import { useLang } from '../LangContext'
import ProposalList from '../components/ProposalList'
import KpiProposal from '../components/KpiProposal'
import { ConfirmModal } from '../components/Modal'

function Message({ msg, onConfirmed, onConfirmMeeting, onEdit, onResend, tr }) {
    const html = { __html: marked.parse(msg.content || '') }
    const mp = msg.meeting_proposal
    const mpEmailAttendees = mp ? (mp.attendees || []).filter(a => a.includes('@')) : []
    const mpNameOnly = mp
        ? (mp.unresolved_names?.length ? mp.unresolved_names : (mp.attendees || []).filter(a => !a.includes('@')))
        : []
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

                {msg.delete_proposal && !msg.confirmed && (
                    <div className="delete-proposal">
                        <div className="proposal-card">
                            <div className="proposal-header">
                                <span className="proposal-icon">🗑️</span>
                                <span>{tr(msg.delete_proposal.target_type === 'kpi' ? 'delete_proposal.title_kpi' : 'delete_proposal.title_objective')}</span>
                            </div>
                            <div className="proposal-body">
                                <p><strong>{msg.delete_proposal.target_name}</strong></p>
                                {msg.delete_proposal.reason && (
                                    <p className="reason">{tr('delete_proposal.reason', { reason: msg.delete_proposal.reason })}</p>
                                )}
                                <p className="reason">{tr('delete_proposal.archive_note')}</p>
                            </div>
                            <div className="proposal-actions">
                                <button className="btn-confirm" onClick={() => onConfirmed(msg)}>{tr('delete_proposal.confirm')}</button>
                                <button className="btn-cancel" onClick={() => onConfirmed(msg, true)}>{tr('delete_proposal.cancel')}</button>
                            </div>
                        </div>
                    </div>
                )}

                {(msg.proposed_kpis?.length > 0 || msg.proposed_objectives?.length > 0) && !msg.confirmed && (
                    <KpiProposal
                        kpis={msg.proposed_kpis}
                        newObjectives={msg.proposed_objectives}
                        weightChanges={msg.weight_changes}
                        onConfirmed={() => onConfirmed(msg)}
                        onDismiss={() => onConfirmed(msg, true)}
                    />
                )}
                {msg.meeting_proposal && !msg.confirmed && (
                    <div className="delete-proposal">
                        <div className="proposal-card">
                            <div className="proposal-header">
                                <span className="proposal-icon">📅</span>
                                <span>{tr('meeting_proposal.heading')}</span>
                            </div>
                            <div className="proposal-body">
                                <p><strong>{msg.meeting_proposal.title}</strong></p>
                                <p>🕐 {msg.meeting_proposal.start_datetime.slice(0, 16).replace('T', ' ')} → {msg.meeting_proposal.end_datetime.slice(11, 16)}</p>
                                {mpEmailAttendees.length > 0 && (
                                    <p>{tr('meeting_proposal.email_attendees')} {mpEmailAttendees.join(', ')}</p>
                                )}
                                {mpNameOnly.length > 0 && (
                                    <p className="reason">{tr('meeting_proposal.name_only_warn', { names: mpNameOnly.join(', ') })}</p>
                                )}
                                {msg.meeting_proposal.description && (
                                    <p className="reason">{msg.meeting_proposal.description}</p>
                                )}
                                {msg.meeting_proposal.location && (
                                    <p>📍 {msg.meeting_proposal.location}</p>
                                )}
                            </div>
                            <div className="proposal-actions">
                                <button className="btn-confirm" onClick={() => onConfirmMeeting(msg)}>{tr('meeting_proposal.confirm')}</button>
                                <button className="btn-cancel" onClick={() => onConfirmed(msg, true)}>{tr('meeting_proposal.cancel')}</button>
                            </div>
                        </div>
                    </div>
                )}
                {msg.confirmed === 'saved' && !msg.meeting_link && (
                    <div className="confirmed-note">{tr('chat.saved')}</div>
                )}
                {msg.confirmed === 'saved' && msg.meeting_link && (
                    <div className="confirmed-note">
                        ✅ {tr('meeting_proposal.created')}{' '}
                        <a href={msg.meeting_link} target="_blank" rel="noreferrer">{tr('meeting_proposal.open_link')}</a>
                    </div>
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
    const [deleteConfirm, setDeleteConfirm] = useState(null)
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
            history.map((m) => {
                // pending -> hien lai the de xuat de nguoi dung con xac nhan duoc;
                // saved/dismissed -> hien ghi chu trang thai; tin cu khong co status -> an het nhu truoc
                const status = m.meta?.proposal_status
                return {
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    proposed_items: m.meta?.proposed_items || [],
                    proposed_kpis: m.meta?.proposed_kpis || [],
                    proposed_objectives: m.meta?.proposed_objectives || [],
                    weight_changes: m.meta?.weight_changes || [],
                    delete_proposal: m.meta?.delete_proposal,
                    meeting_proposal: null,
                    confirmed: status === 'pending' ? undefined : (status || 'history'),
                }
            }),
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

    const removeSession = (e, id) => {
        e.stopPropagation()
        setDeleteConfirm(id)
    }
    const doDeleteSession = async () => {
        if (!deleteConfirm) return
        await api.deleteChatSession(deleteConfirm)
        if (deleteConfirm === activeId) newChat()
        setDeleteConfirm(null)
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
                    id: res.message_id,
                    role: 'assistant',
                    content: res.reply,
                    proposed_items: res.proposed_items || [],
                    proposed_kpis: res.proposed_kpis || [],
                    proposed_objectives: res.proposed_objectives || [],
                    weight_changes: res.weight_changes || [],
                    delete_proposal: res.delete_proposal,
                    meeting_proposal: res.meeting_proposal || null,
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

    const handleConfirmMeeting = async (msg) => {
        try {
            const result = await api.confirmMeeting(msg.meeting_proposal)
            setMessages((all) =>
                all.map((m) => (m === msg ? { ...m, confirmed: 'saved', meeting_link: result.html_link } : m)),
            )
            if (msg.id) api.setProposalStatus(msg.id, 'saved').catch(() => {})
        } catch (e) {
            setMessages((all) => [
                ...all,
                { role: 'assistant', content: tr('chat.error_prefix', { message: e.message }) },
            ])
        }
    }

    const markConfirmed = async (msg, dismissed = false) => {
        // ProposalList / KpiProposal tự gọi API confirm của chúng TRƯỚC khi báo về đây —
        // ở đây chỉ gọi API cho thẻ xóa (thẻ này không có component riêng).
        if (!dismissed && msg.delete_proposal?.target_id) {
            try {
                await api.confirmDeleteKpi({
                    target_type: msg.delete_proposal.target_type,
                    target_id: msg.delete_proposal.target_id,
                    reason: msg.delete_proposal.reason || '',
                })
            } catch (e) {
                setMessages((all) => [
                    ...all,
                    { role: 'assistant', content: tr('chat.error_prefix', { message: e.message }) },
                ])
                return
            }
        }
        const status = dismissed ? 'dismissed' : 'saved'
        setMessages((all) =>
            all.map((m) => (m === msg ? { ...m, confirmed: status } : m)),
        )
        // luu trang thai xuong DB de mo lai phien / doi trang van hien dung — loi thi nuot,
        // khong duoc chan luong chinh (du lieu de xuat da duoc luu o cac API confirm rieng)
        if (msg.id) api.setProposalStatus(msg.id, status).catch(() => {})
    }


    return (
        <>
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
                {/* Agent tu hoc chay NEN (agent_memories) — chu dich khong hien UI;
                    xem/xoa khi can qua API GET/DELETE /api/chat/memories */}
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
                        <Message key={i} msg={m} onConfirmed={markConfirmed} onConfirmMeeting={handleConfirmMeeting} onEdit={editMessage} onResend={send} tr={tr} />
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
        <ConfirmModal
            open={!!deleteConfirm}
            title={tr('chat.delete_confirm')}
            message={tr('chat.delete_confirm')}
            confirmLabel={tr('common.ok')}
            confirmVariant="danger"
            onConfirm={doDeleteSession}
            onCancel={() => setDeleteConfirm(null)}
        />
        </>
    )
}