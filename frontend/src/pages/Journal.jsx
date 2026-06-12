import { useEffect, useMemo, useState } from 'react'
import { api, STATUS_LABELS, STATUS_COLORS, SOURCE_LABELS } from '../api'

const FIELD_LABELS = {
  name: 'Tên', description: 'Mô tả', target: 'Chỉ tiêu', weight: 'Trọng số',
  deadline: 'Deadline', unit: 'Đơn vị', target_value: 'Chỉ tiêu số',
  current_value: 'Thực đạt', progress: 'Tiến độ', objective: 'Mục tiêu', archived: 'Gỡ bỏ/Khôi phục',
}

function EvidenceTab() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { api.listWorkItems().then(setItems).catch(() => {}) }, [])

  const filtered = useMemo(() => items.filter((w) =>
    (!status || w.status === status) &&
    (!source || w.source === source) &&
    (!search || (w.title + (w.kpi_name || '') + w.source_ref).toLowerCase().includes(search.toLowerCase()))
  ), [items, status, source, search])

  return (
    <>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <label>Trạng thái
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tất cả</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Nguồn
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Tất cả</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ flex: 1 }}>Tìm kiếm
          <input placeholder="Tên việc, KPI, nguồn gốc…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <span className="muted">{filtered.length}/{items.length} đầu việc</span>
      </div>
      <div className="card">
        {filtered.length === 0 ? <p className="muted">Không có đầu việc nào khớp bộ lọc.</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>Ngày thực hiện</th><th>Ghi nhận lúc</th><th>Đầu việc</th>
                <th>Trạng thái</th><th>KPI</th><th>+Thực đạt</th><th>Nguồn</th><th>Nguồn gốc dữ liệu</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id}>
                  <td className="nowrap">{w.work_date || <span className="muted">—</span>}</td>
                  <td className="nowrap muted">{w.created_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td>{w.title}</td>
                  <td><span className="status-chip" style={{ color: STATUS_COLORS[w.status] }}>{STATUS_LABELS[w.status]}</span></td>
                  <td>{w.kpi_name || <span className="muted">(chưa gắn)</span>}</td>
                  <td>{w.progress_delta ? `${w.progress_delta > 0 ? '+' : ''}${w.progress_delta}` : '—'}</td>
                  <td className="nowrap">{SOURCE_LABELS[w.source] || w.source}</td>
                  <td className="muted">{w.source_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function HistoryTab() {
  const [logs, setLogs] = useState([])
  const [archived, setArchived] = useState([])
  const [error, setError] = useState('')

  const load = () =>
    Promise.all([api.allChangelog(), api.archivedKpis()])
      .then(([l, a]) => { setLogs(l); setArchived(a) })
      .catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const restore = async (kpi) => {
    if (!confirm(`Khôi phục KPI "${kpi.name}"? (nếu nhóm không còn đủ trọng số, trọng số sẽ tự hạ xuống phần còn trống)`)) return
    try {
      await api.restoreKpi(kpi.id)
      load()
    } catch (e) { setError(e.message) }
  }

  return (
    <>
      {error && <div className="error-text">⚠️ {error}</div>}
      {archived.length > 0 && (
        <div className="card">
          <h3>🗂 KPI đã gỡ bỏ ({archived.length})</h3>
          {archived.map((k) => (
            <div className="todo-row" key={k.id}>
              <div className="todo-main">
                <span className="todo-title">{k.name}</span>
                <span className="muted">
                  {k.unit === '%' ? `Thực đạt ${k.current_value}%` : `Thực đạt ${k.current_value}/${k.target_value} ${k.unit}`}
                  {k.objective_name ? ` · 🏁 ${k.objective_name}` : ''}
                </span>
              </div>
              <button className="btn small" onClick={() => restore(k)}>♻️ Khôi phục</button>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <h3>🕒 Toàn bộ lịch sử thay đổi ({logs.length})</h3>
        {logs.length === 0 ? <p className="muted">Chưa có thay đổi nào.</p> : (
          <table className="table">
            <thead>
              <tr><th>Thời gian</th><th>KPI</th><th>Trường</th><th>Cũ</th><th>Mới</th><th>Lý do</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{l.changed_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td>{l.kpi_name || `#${l.kpi_id}`}</td>
                  <td className="nowrap">{FIELD_LABELS[l.field] || l.field}</td>
                  <td>{l.old_value}</td>
                  <td><b>{l.new_value}</b></td>
                  <td className="muted">{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

export default function Journal() {
  const [tab, setTab] = useState('evidence')
  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>📒 Nhật ký</h1>
          <p>Toàn bộ bằng chứng công việc và lịch sử thay đổi KPI — kể cả KPI đã gỡ bỏ.</p>
        </div>
        <a className="btn" href={api.exportUrl}>📥 Xuất Excel</a>
      </header>
      <div className="period-tabs">
        <button className={`period-tab ${tab === 'evidence' ? 'active' : ''}`} onClick={() => setTab('evidence')}>
          📋 Bằng chứng công việc
        </button>
        <button className={`period-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          🕒 Lịch sử KPI
        </button>
      </div>
      {tab === 'evidence' ? <EvidenceTab /> : <HistoryTab />}
    </div>
  )
}
