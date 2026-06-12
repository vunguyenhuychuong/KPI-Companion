import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import Kpis from './pages/Kpis'
import Journal from './pages/Journal'
import Reports from './pages/Reports'
import Sources from './pages/Sources'
import Login from './pages/Login'

function loadUser() {
  try { return JSON.parse(localStorage.getItem('kpi_user') || 'null') } catch { return null }
}

export default function App() {
  const [user, setUser] = useState(loadUser)

  function handleLogin(userData) {
    setUser(userData)
  }

  function handleLogout() {
    localStorage.removeItem('kpi_token')
    localStorage.removeItem('kpi_user')
    setUser(null)
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">🎯</span>
          <div>
            <div className="logo-title">KPI Companion</div>
            <div className="logo-sub">Trợ lý KPI cá nhân</div>
          </div>
        </div>
        <nav>
          <NavLink to="/dashboard">📊 Dashboard</NavLink>
          <NavLink to="/chat">💬 Trợ lý AI</NavLink>
          <NavLink to="/kpis">🎯 KPI của tôi</NavLink>
          <NavLink to="/reports">📝 Báo cáo</NavLink>
          <NavLink to="/journal">📒 Nhật ký</NavLink>
          <NavLink to="/sources">🔌 Nguồn dữ liệu</NavLink>
        </nav>
        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {user.picture
              ? <img src={user.picture} alt="" referrerPolicy="no-referrer"
                  style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
              : <div style={{
                  width: 30, height: 30, borderRadius: '50%', background: '#334155', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: '#94a3b8',
                }}>
                  {(user.name || '?')[0].toUpperCase()}
                </div>
            }
            <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {user.name}
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
              borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.target.style.background = '#334155'; e.target.style.color = '#fff' }}
            onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = '#94a3b8' }}
          >
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/kpis" element={<Kpis />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/sources" element={<Sources />} />
        </Routes>
      </main>
    </div>
  )
}
