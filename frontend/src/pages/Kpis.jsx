import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

const EMPTY = { name: '', description: '', target: '', weight: 10, year: 2026, deadline: '' }

export default function Kpis() {
  const [kpis, setKpis] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [changelog, setChangelog] = useState({})
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const load = () => api.listKpis().then(setKpis).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.createKpi({ ...form, weight: Number(form.weight), deadline: form.deadline || null })
      setForm(EMPTY)
      setShowForm(false)
      load()
    } catch (err) { setError(err.message) }
  }

  const importFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const created = await api.importKpis(file)
      alert(`Đã import ${created.length} KPI từ file.`)
      load()
    } catch (err) { setError(err.message) } finally { e.target.value = '' }
  }

  const decompose = async (id) => {
    setBusyId(id)
    setError('')
    try {
      await api.decomposeKpi(id)
      await load()
      setExpanded(id)
    } catch (err) { setError(err.message) } finally { setBusyId(null) }
  }

  const archive = async (kpi) => {
    const reason = prompt(`Lý do gỡ bỏ KPI "${kpi.name}"? (sẽ lưu vào lịch sử thay đổi)`)
    if (reason === null) return
    await api.deleteKpi(kpi.id, reason)
    load()
  }

  const editWeight = async (kpi) => {
    const w = prompt(`Trọng số mới cho "${kpi.name}" (hiện tại ${kpi.weight}%)?`)
    if (w === null || isNaN(Number(w))) return
    const reason = prompt('Lý do thay đổi?') || ''
    await api.updateKpi(kpi.id, { weight: Number(w), reason })
    load()
  }

  const toggleLog = async (id) => {
    if (changelog[id]) { setChangelog((c) => ({ ...c, [id]: null })); return }
    const logs = await api.kpiChangelog(id)
    setChangelog((c) => ({ ...c, [id]: logs }))
  }

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1>🎯 KPI của tôi</h1>
          <p>Khai báo KPI đầu năm, để Agent phân rã SMART theo quý / tháng.</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => fileRef.current?.click()}>📤 Import Excel/CSV</button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={importFile} />
          <button className="btn primary" onClick={() => setShowForm(!showForm)}>＋ Thêm KPI</button>
        </div>
      </header>

      {error && <div className="error-text">⚠️ {error}</div>}

      {showForm && (
        <form className="card kpi-form" onSubmit={submit}>
          <input required placeholder="Tên KPI *" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Mô tả" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input placeholder="Chỉ tiêu đo lường (vd: 4/4 báo cáo đúng hạn)" value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })} />
          <div className="form-row">
            <label>Trọng số %
              <input type="number" min="0" max="100" value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </label>
            <label>Deadline
              <input type="date" value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </label>
            <button className="btn primary" type="submit">Lưu KPI</button>
          </div>
        </form>
      )}

      {kpis.map((kpi) => (
        <div className="card kpi-row" key={kpi.id}>
          <div className="kpi-row-head">
            <div>
              <strong>{kpi.name}</strong>
              <div className="kpi-meta">
                {kpi.target && <>🎯 {kpi.target} · </>}
                Trọng số {kpi.weight}% · Deadline {kpi.deadline || `${kpi.year}-12-31`} · Tiến độ {kpi.progress}%
              </div>
            </div>
            <div className="kpi-row-actions">
              <button className="btn small" disabled={busyId === kpi.id} onClick={() => decompose(kpi.id)}>
                {busyId === kpi.id ? 'Agent đang phân rã…' : kpi.sub_goals?.length ? '🔄 Phân rã lại' : '✨ Phân rã SMART'}
              </button>
              {kpi.sub_goals?.length > 0 && (
                <button className="btn small ghost" onClick={() => setExpanded(expanded === kpi.id ? null : kpi.id)}>
                  {expanded === kpi.id ? 'Thu gọn' : `Xem ${kpi.sub_goals.length} mục tiêu nhỏ`}
                </button>
              )}
              <button className="btn small ghost" onClick={() => editWeight(kpi)}>✏️ Trọng số</button>
              <button className="btn small ghost" onClick={() => toggleLog(kpi.id)}>🕒 Lịch sử</button>
              <button className="btn small danger" onClick={() => archive(kpi)}>Gỡ bỏ</button>
            </div>
          </div>

          {expanded === kpi.id && kpi.sub_goals?.length > 0 && (
            <div className="subgoals">
              {['quarter', 'month'].map((pt) => (
                <div key={pt}>
                  <h4>{pt === 'quarter' ? 'Theo quý' : 'Theo tháng'}</h4>
                  <ul>
                    {kpi.sub_goals.filter((s) => s.period_type === pt).map((s) => (
                      <li key={s.id}>
                        <b>{s.period_label}</b>: {s.description}
                        <span className="muted"> (kỳ vọng cộng dồn {s.expected_progress}%)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {changelog[kpi.id] && (
            <div className="changelog">
              <h4>Lịch sử thay đổi</h4>
              {changelog[kpi.id].length === 0 ? <p className="muted">Chưa có thay đổi nào.</p> : (
                <table className="table">
                  <thead><tr><th>Ngày</th><th>Trường</th><th>Cũ</th><th>Mới</th><th>Lý do</th></tr></thead>
                  <tbody>
                    {changelog[kpi.id].map((l) => (
                      <tr key={l.id}>
                        <td>{l.changed_at?.slice(0, 10)}</td><td>{l.field}</td>
                        <td>{l.old_value}</td><td>{l.new_value}</td><td>{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
