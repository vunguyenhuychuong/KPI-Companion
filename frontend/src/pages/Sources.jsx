import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ProposalList from '../components/ProposalList'

const SOURCES = [
  { key: 'gmail', label: '✉️ Gmail', desc: 'Email giao việc, báo cáo đã gửi/nhận' },
  { key: 'calendar', label: '📅 Google Calendar', desc: 'Cuộc họp, sự kiện đã tham gia' },
  { key: 'sheets', label: '📊 Google Sheets', desc: 'Timesheet, log công việc trên Sheet' },
]

function lastMonday() {
  const d = new Date()
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

export default function Sources() {
  const [status, setStatus] = useState(null)
  const [selected, setSelected] = useState(['gmail', 'calendar', 'sheets'])
  const [start, setStart] = useState(lastMonday())
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { api.sourcesStatus().then(setStatus).catch(() => {}) }, [])

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
        <h1>🔌 Nguồn dữ liệu</h1>
        <p>Agent tự quét dữ liệu công việc, bạn chỉ cần xác nhận kết quả phân loại.</p>
      </header>

      {status && (
        <div className={`mode-banner ${status.gmail === 'mock' ? 'mock' : 'real'}`}>
          {status.gmail === 'mock'
            ? '🧪 Đang chạy chế độ DEMO (mock data). ' + status.note
            : '🟢 Đã kết nối Google API thật.'}
        </div>
      )}

      <div className="card">
        <h3>Quét từ Google</h3>
        <div className="source-list">
          {SOURCES.map((s) => (
            <label key={s.key} className={`source-item ${selected.includes(s.key) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected.includes(s.key)} onChange={() => toggle(s.key)} />
              <div>
                <div className="source-name">{s.label}</div>
                <div className="muted">{s.desc}</div>
              </div>
              {status && <span className={`badge ${status[s.key]}`}>{status[s.key] === 'mock' ? 'demo' : 'thật'}</span>}
            </label>
          ))}
        </div>
        <div className="form-row">
          <label>Từ ngày <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Đến ngày <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <button className="btn primary" onClick={sync} disabled={busy || selected.length === 0}>
            {busy ? 'Agent đang quét và phân loại…' : '🔍 Quét ngay'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Hoặc upload file Excel / CSV</h3>
        <p className="muted">Timesheet, log công việc — cần cột: Ngày, Công việc, Trạng thái, Ghi chú (tên cột linh hoạt, Agent tự nhận diện).</p>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>📤 Chọn file</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={upload} />
      </div>

      {error && <div className="error-text">⚠️ {error}</div>}

      {result && (
        <div className="card">
          <p>{result.reply}</p>
          {result.proposed_items?.length > 0 ? (
            <ProposalList
              items={result.proposed_items}
              onConfirmed={() => setResult({ ...result, proposed_items: [], reply: '✅ Đã lưu và cập nhật tiến độ KPI. Xem Dashboard để thấy thay đổi.' })}
              onDismiss={() => setResult(null)}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
