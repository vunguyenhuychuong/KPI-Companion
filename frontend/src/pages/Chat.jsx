import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { api } from '../api'
import ProposalList from '../components/ProposalList'

const SUGGESTIONS = [
  'Tuần này tôi đã hoàn thành báo cáo ITGC quý 2, đang xử lý ticket workflow bị kẹt, tuần sau bắt đầu chuẩn bị tài liệu audit. Ngoài ra phát sinh thêm việc hỗ trợ dự án ISO.',
  'Cập nhật tuần này từ Gmail và Calendar',
  'KPI nào đang chậm tiến độ?',
  'Tổng kết tuần này giúp tôi',
]

function Message({ msg, onConfirmed }) {
  const html = { __html: marked.parse(msg.content || '') }
  return (
    <div className={`msg ${msg.role}`}>
      <div className="msg-avatar">{msg.role === 'user' ? '🧑' : '🤖'}</div>
      <div className="msg-body">
        <div className="msg-content" dangerouslySetInnerHTML={html} />
        {msg.proposed_items?.length > 0 && !msg.confirmed && (
          <ProposalList
            items={msg.proposed_items}
            onConfirmed={() => onConfirmed(msg)}
            onDismiss={() => onConfirmed(msg, true)}
          />
        )}
        {msg.confirmed === 'saved' && <div className="confirmed-note">✅ Đã lưu và cập nhật tiến độ KPI</div>}
        {msg.confirmed === 'dismissed' && <div className="confirmed-note muted">Đã bỏ qua</div>}
      </div>
    </div>
  )
}

export default function Chat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    api.chatHistory().then((history) => {
      setMessages(
        history.map((m) => ({
          role: m.role,
          content: m.content,
          proposed_items: m.meta?.proposed_items || [],
          confirmed: 'history', // khong cho xac nhan lai tu lich su
        })),
      )
    }).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const send = async (text) => {
    const message = (text ?? input).trim()
    if (!message || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: message }])
    setBusy(true)
    try {
      const res = await api.sendChat(message)
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.reply, proposed_items: res.proposed_items || [] },
      ])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ Lỗi: ${e.message}` }])
    } finally {
      setBusy(false)
    }
  }

  const markConfirmed = (msg, dismissed = false) => {
    setMessages((all) =>
      all.map((m) => (m === msg ? { ...m, confirmed: dismissed ? 'dismissed' : 'saved' } : m)),
    )
  }

  return (
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
          <Message key={i} msg={m} onConfirmed={markConfirmed} />
        ))}
        {busy && (
          <div className="msg assistant">
            <div className="msg-avatar">🤖</div>
            <div className="msg-body"><div className="typing">Agent đang suy nghĩ…</div></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input">
        <textarea
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
  )
}
