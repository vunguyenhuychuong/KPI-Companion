import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'
import { prefs } from '../prefs'
import { UiIcon } from './UiIcon'

const SEV_COLOR = { high: '#dc2626', medium: '#ca8a04', low: '#6b7194' }
const TYPE_ICON = { behind: 'chartDown', deadline: 'calendar', overdue: 'clock', runrate: 'sparkles' }

// Chuông thông báo chủ động (M3): badge số chưa đọc, mở danh sách, ẩn từng cái.
// Trạng thái đã đọc/đã ẩn lưu localStorage (chống lặp) — không hiện lại tới khi trạng thái KPI đổi (id có severity).
export default function NotificationsBell() {
  const { tr } = useLang()
  const [notifs, setNotifs] = useState([])
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(prefs.getNotifDismissed())
  const [read, setRead] = useState(prefs.getNotifRead())
  const ref = useRef(null)

  useEffect(() => { api.notifications().then(setNotifs).catch(() => {}) }, [])
  useEffect(() => {
    const t = setInterval(() => {
      api.notifications().then(setNotifs).catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const visible = notifs.filter((n) => !dismissed.includes(n.id))
  const unread = visible.filter((n) => !read.includes(n.id))

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && unread.length) {
      prefs.addNotifRead(visible.map((n) => n.id))
      setRead(prefs.getNotifRead())
    }
  }
  const dismiss = (id) => { prefs.addNotifDismissed(id); setDismissed(prefs.getNotifDismissed()) }

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="notif-bell" onClick={toggle} title={tr('notif.title')} aria-label={tr('notif.title')}>
        <UiIcon name="bell" />
        {unread.length > 0 && <span className="notif-badge">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-head">{tr('notif.title')}{visible.length > 0 && ` (${visible.length})`}</div>
          {visible.length === 0 ? (
            <div className="notif-empty">{tr('notif.empty')}</div>
          ) : visible.map((n) => (
            <div className={`notif-item ${read.includes(n.id) ? '' : 'unread'}`} key={n.id}>
              <span className="notif-ico" style={{ color: SEV_COLOR[n.severity] }}><UiIcon name={TYPE_ICON[n.type] || 'warning'} /></span>
              <div className="notif-body">
                <div className="notif-name" title={n.title}>{n.title}</div>
                <div className="notif-msg">{tr('notif.msg_' + n.type, n.params)}</div>
              </div>
              <button className="notif-x" onClick={() => dismiss(n.id)} title={tr('notif.dismiss')}><UiIcon name="x" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
