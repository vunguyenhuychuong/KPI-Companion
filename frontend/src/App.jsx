import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import Kpis from './pages/Kpis'
import Journal from './pages/Journal'
import Reports from './pages/Reports'
import Sources from './pages/Sources'
import Login from './pages/Login'
import { LangProvider, useLang } from './LangContext'

function loadUser() {
  try { return JSON.parse(localStorage.getItem('kpi_user') || 'null') } catch { return null }
}

function AppContent() {
  const [user, setUser] = useState(loadUser)
  const { tr, lang, toggleLang } = useLang()

  function handleLogin(userData) { setUser(userData) }

  function handleLogout() {
    localStorage.removeItem('kpi_token')
    localStorage.removeItem('kpi_user')
    setUser(null)
  }

  if (!user) return <Login onLogin={handleLogin} />

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">🎯</span>
          <div>
            <div className="logo-title">{tr('app.title')}</div>
            <div className="logo-sub">{tr('app.subtitle')}</div>
          </div>
        </div>
        <nav>
          <NavLink to="/dashboard">{tr('nav.dashboard')}</NavLink>
          <NavLink to="/chat">{tr('nav.chat')}</NavLink>
          <NavLink to="/kpis">{tr('nav.kpis')}</NavLink>
          <NavLink to="/reports">{tr('nav.reports')}</NavLink>
          <NavLink to="/journal">{tr('nav.journal')}</NavLink>
          <NavLink to="/sources">{tr('nav.sources')}</NavLink>
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
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={toggleLang}
              style={{
                background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
                borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                fontWeight: 700, letterSpacing: 1, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.target.style.background = '#334155'; e.target.style.color = '#fff' }}
              onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = '#94a3b8' }}
              title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
            >
              🌐 {lang === 'vi' ? 'EN' : 'VI'}
            </button>
            <button
              onClick={handleLogout}
              style={{
                flex: 1, background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
                borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.target.style.background = '#334155'; e.target.style.color = '#fff' }}
              onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = '#94a3b8' }}
            >
              {tr('nav.logout')}
            </button>
          </div>
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

export default function App() {
  return (
    <LangProvider>
      <AppContent />
    </LangProvider>
  )
}
