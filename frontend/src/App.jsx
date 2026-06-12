import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import Kpis from './pages/Kpis'
import Journal from './pages/Journal'
import Reports from './pages/Reports'
import Sources from './pages/Sources'

export default function App() {
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
          <div className="sidebar-footer">
            Hackathon 2026 · Team Tính-Chương-Nam
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
