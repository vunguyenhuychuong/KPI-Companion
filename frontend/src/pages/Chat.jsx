import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'
import ProposalList from '../components/ProposalList'
import KpiProposal from '../components/KpiProposal'

const SUGGESTIONS = [
    'Tuần này tôi đã hoàn thành báo cáo ITGC quý 2, đang xử lý ticket workflow bị kẹt, tuần sau bắt đầu chuẩn bị tài liệu audit. Ngoài ra phát sinh thêm việc hỗ trợ dự án ISO.',
    'Cập nhật tuần này từ Gmail và Calendar',
    'KPI nào đang chậm tiến độ?',
    'Tổng kết tuần này giúp tôi',
]

function Message({ msg, onConfirmed, onEdit, onResend }) {
    const html = { __html: marked.parse(msg.content || '') }
    return (
        <div className={`msg ${msg.role}`}>
            <div className="msg-avatar">{msg.role === 'user' ? '🧑' : '🤖'}</div>
            <div className="msg-body">
                <div className="msg-content" dangerouslySetInnerHTML={html} />
                {msg.role === 'user' && (
                    <div className="msg-tools">
                        <button className="msg-tool" title="Sửa rồi gửi lại" onClick={() => onEdit(msg.content)}>✏️ Sửa</button>
                        <button className="msg-tool" title="Gửi lại nguyên văn" onClick={() => onResend(msg.content)}>↻ Hỏi lại</button>
                    </div>
                )}
                {msg.duration != null && (
                    <div className="msg-duration">⏱ trả lời sau {msg.duration}s</div>
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
                    <div className="confirmed-note">
                        ✅ Đã lưu vào hệ thống — xem ở trang KPI của tôi / Dashboard
                    </div>
                )}
                {msg.confirmed === 'dismissed' && <div className="confirmed-note muted">Đã bỏ qua</div>}
            </div>
        </div>
    )
}

function Thinking() {
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
                    Agent đang suy nghĩ… <b>{secs}s</b>
                    {secs >= 30 && <span className="typing-slow"> (mạng/model đang chậm, tối đa chờ 90s)</span>}
                </div>
            </div>
        </div>
    )
}

export default function Chat() {
    const [sessions, setSessions] = useState([])
    const [activeId, setActiveId] = useState(null) // null = phien moi chua tao
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
                confirmed: 'history', // khong cho xac nhan lai tu lich su
            })),
        )
    }

    // mo phien gan nhat khi vao trang (neu co)
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
        if (!confirm('Xóa phiên chat này? (Đầu việc đã xác nhận vẫn được giữ)')) return
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
            const res = await api.sendChat(message, activeId)
            const duration = Math.round((Date.now() - started) / 10) / 100
            if (res.session_id && res.session_id !== activeId) {
                setActiveId(res.session_id)
                loadSessions() // phien moi vua duoc tao + dat ten
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
                ? '⚠️ Agent không phản hồi sau 90 giây. Kiểm tra kết nối tới LLM endpoint (backend/.env) rồi thử lại.'
                : `⚠️ Lỗi: ${e.message}`
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
                <button className="btn primary new-chat-btn" onClick={newChat}>＋ Chat mới</button>
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
                            <button className="btn-icon session-del" title="Xóa phiên" onClick={(e) => removeSession(e, s.id)}>✕</button>
                        </div>
                    ))}
                    {sessions.length === 0 && <p className="muted session-empty">Chưa có phiên chat nào.</p>}
                </div>
            </aside>

            <div className="chat-page">
                <header className="page-header">
                    <h1>💬 Trợ lý AI</h1>
                    <p>Kể công việc của bạn bằng tiếng Việt, hoặc ra lệnh quét dữ liệu từ Gmail / Calendar / Sheets.</p>
                </header>
                <div className="chat-messages">
                    {messages.length === 0 && (
                        <div className="chat-empty">
                            <h3>👋 Xin chào! Tôi là KPI Companion.</h3>
                            <p>Thử một trong các câu sau:</p>
                            <div className="suggestions">
                                {SUGGESTIONS.map((s) => (
                                    <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>
                                ))}
                            </div>
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <Message key={i} msg={m} onConfirmed={markConfirmed} onEdit={editMessage} onResend={send} />
                    ))}
                    {busy && <Thinking />}
                    <div ref={bottomRef} />
                </div>
                <div className="chat-input">
          <textarea
              ref={inputRef}
              rows={2}
              placeholder="Mô tả công việc tuần này, hoặc gõ: Cập nhật tuần này từ Gmail và Calendar…"
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
                        Gửi
                    </button>
                </div>
            </div>
        </div>
    )
}
