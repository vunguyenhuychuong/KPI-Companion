import { useState, useEffect, useRef } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import Kpis from './pages/Kpis'
import Journal from './pages/Journal'
import Reports from './pages/Reports'
import Sources from './pages/Sources'
import Settings from './pages/Settings'
import Login from './pages/Login'
import SharedReport from './pages/SharedReport'
import { LangProvider, useLang } from './LangContext'
import { ThemeProvider, useTheme } from './ThemeContext'
import { ViewProvider } from './ViewContext'
import { CycleProvider, useCycle } from './CycleContext'
import NotificationsBell from './components/NotificationsBell'
import OnboardingWizard from './components/OnboardingWizard'
import HelpPanel from './components/HelpPanel'
import { ToastProvider } from './components/Toast'
import { api } from './api'

function loadUser() {
  try { return JSON.parse(localStorage.getItem('kpi_user') || 'null') } catch { return null }
}

// D5: Route public cho shared report (không cần login)
function SharedReportRoute() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/shared/:token" element={<SharedReport />} />
      </Routes>
    </ThemeProvider>
  )
}

// Icon SVG nội tuyến (stroke = currentColor) — hiển thị nét sắc mọi nơi, không phụ thuộc font emoji
const I = (p) => <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>
const ICONS = {
  dashboard: I(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  chat: I(<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9 9 0 0 1-4-1L3 20l1-3.5a8.5 8.5 0 1 1 16-5z" />),
  kpis: I(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>),
  reports: I(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>),
  journal: I(<><path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 1-2-2z" /><path d="M9 3v17M19 8H4" /></>),
  sources: I(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" /></>),
  settings: I(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
}

// Icon nho cho cum dieu khien (theme/lang/logout) — kich thuoc do CSS quyet dinh
const Sico = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>
const SUN = Sico(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
const MOON = Sico(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />)
const GLOBE = Sico(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>)
const LOGOUT_ICON = Sico(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>)
const HELP_ICON = Sico(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.8 2.8 0 0 1 5.1 1.6c0 2-2.6 2.1-2.6 4" /><path d="M12 18h.01" /></>)
const PANEL_ICON = Sico(<><path d="M4 5h16M4 12h16M4 19h16" /><path d="M9 5v14" /></>)
const NAV = [
  { to: '/dashboard', key: 'nav.dashboard', icon: 'dashboard' },
  { to: '/chat', key: 'nav.chat', icon: 'chat' },
  { to: '/kpis', key: 'nav.kpis', icon: 'kpis' },
  { to: '/reports', key: 'nav.reports', icon: 'reports' },
  { to: '/journal', key: 'nav.journal', icon: 'journal' },
  { to: '/sources', key: 'nav.sources', icon: 'sources' },
  { to: '/settings', key: 'nav.settings', icon: 'settings' },
]

const PAGE_TITLE_KEYS = {
  '/dashboard': 'nav.dashboard',
  '/chat':      'nav.chat',
  '/kpis':      'nav.kpis',
  '/reports':   'nav.reports',
  '/journal':   'nav.journal',
  '/sources':   'nav.sources',
  '/settings':  'nav.settings',
}

function CycleSelector() {
  const { cycles, activeCycleId, setActiveCycleId, loading, currentYear } = useCycle()
  const { tr } = useLang()
  if (loading || cycles.length === 0) return null
  return (
    <select
      className="cycle-selector"
      value={activeCycleId ?? ''}
      onChange={e => setActiveCycleId(e.target.value ? parseInt(e.target.value, 10) : null)}
      title={tr('cycle.active') || 'Chu kỳ hiện tại'}
      aria-label={tr('cycle.active') || 'Chu kỳ hiện tại'}
    >
      {cycles.map(c => (
        <option key={c.id} value={c.id}>
          {c.name || `Năm ${currentYear}`}{c.is_locked ? ' 🔒' : ''}
        </option>
      ))}
    </select>
  )
}

function AppContent() {
  const [user, setUser] = useState(loadUser)
  const { tr, lang, toggleLang } = useLang()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const mainRef = useRef(null)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [showOnboardingHelp, setShowOnboardingHelp] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('kpi_sidebar_collapsed') === '1')
  const [quickAccountOpen, setQuickAccountOpen] = useState(false)
  const [quickProfile, setQuickProfile] = useState(() => ({
    name: loadUser()?.name || '',
    role: loadUser()?.role || '',
    picture: loadUser()?.picture || '',
  }))
  const [quickMsg, setQuickMsg] = useState('')
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickAvatarUploading, setQuickAvatarUploading] = useState(false)

  useEffect(() => {
    const handler = () => setHeaderScrolled(window.scrollY > 8)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  useEffect(() => {
    if (!user) return
    api.getMe()
      .then(handleUserUpdate)
      .catch(() => {})
    // Chi refresh profile khi doi user, tranh goi lap sau moi lan setUser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const pageTitle = tr(PAGE_TITLE_KEYS[location.pathname] || 'app.title')

  useEffect(() => {
    if (!user) return
    setQuickProfile({
      name: user.name || '',
      role: user.role || '',
      picture: user.picture || '',
    })
  }, [user])

  function handleLogin(userData) { setUser(userData) }

  function handleUserUpdate(userData) {
    const updated = { ...user, ...userData }
    localStorage.setItem('kpi_user', JSON.stringify(updated))
    setUser(updated)
  }

  function handleLogout() {
    localStorage.removeItem('kpi_token')
    localStorage.removeItem('kpi_user')
    setUser(null)
  }

  function toggleSidebar() {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    localStorage.setItem('kpi_sidebar_collapsed', next ? '1' : '0')
  }

  async function saveQuickAccount() {
    setQuickMsg('')
    if (!quickProfile.name.trim()) {
      setQuickMsg(tr('account.name_required'))
      return
    }
    setQuickSaving(true)
    try {
      const updated = await api.updateMe({
        name: quickProfile.name.trim(),
        role: quickProfile.role.trim(),
        picture: quickProfile.picture.trim(),
      })
      handleUserUpdate(updated)
      setQuickMsg(tr('account.profile_saved'))
      setTimeout(() => setQuickAccountOpen(false), 700)
    } catch (e) {
      setQuickMsg(e.message)
    } finally {
      setQuickSaving(false)
    }
  }

  async function uploadQuickAvatar(file) {
    if (!file) return
    setQuickMsg('')
    setQuickAvatarUploading(true)
    try {
      const updated = await api.uploadAvatar(file)
      handleUserUpdate(updated)
      setQuickMsg(tr('account.avatar_uploaded'))
    } catch (e) {
      setQuickMsg(e.message)
    } finally {
      setQuickAvatarUploading(false)
    }
  }

  // D1: Onboarding — hiển thị nếu user chưa hoàn tất
  const needsOnboarding = user && user.onboarding_completed === false

  if (!user) return <Login onLogin={handleLogin} />

  return (
    <div className="layout">
      {(needsOnboarding || showOnboardingHelp) && (
        <OnboardingWizard replay={showOnboardingHelp} onDone={() => {
          const updated = { ...user, onboarding_completed: true }
          setUser(updated)
          localStorage.setItem('kpi_user', JSON.stringify(updated))
          setShowOnboardingHelp(false)
        }} />
      )}
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <div className="logo">
          <span className="logo-icon" aria-hidden="true">K</span>
          <div className="logo-text">
            <div className="logo-title">{tr('app.title')}</div>
            <div className="logo-sub">{tr('app.subtitle')}</div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? tr('nav.expand_sidebar') : tr('nav.collapse_sidebar')}
            aria-label={sidebarCollapsed ? tr('nav.expand_sidebar') : tr('nav.collapse_sidebar')}
          >
            {PANEL_ICON}
          </button>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} title={sidebarCollapsed ? tr(n.key) : undefined}>
              {ICONS[n.icon]}<span>{tr(n.key)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="side-user side-user-btn"
            onClick={() => setQuickAccountOpen(v => !v)}
            title={tr('account.quick_title')}
            aria-label={tr('account.quick_title')}
          >
            {user.picture
              ? <img className="side-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
              : <div className="side-avatar placeholder">{(user.name || '?')[0].toUpperCase()}</div>
            }
            <div className="side-username">
              <span>{user.name}</span>
              {user.role && <small>{user.role}</small>}
            </div>
          </button>
          {quickAccountOpen && (
            <div className="quick-account-panel">
              <div className="quick-account-head">
                <strong>{tr('account.quick_title')}</strong>
                <button className="msg-tool" onClick={() => setQuickAccountOpen(false)} aria-label={tr('common.cancel')}>×</button>
              </div>
              <label className="field-label" htmlFor="quick-name">{tr('account.name')}</label>
              <input
                id="quick-name"
                className="input"
                value={quickProfile.name}
                onChange={e => setQuickProfile(p => ({ ...p, name: e.target.value }))}
                maxLength={100}
              />
              <label className="field-label" htmlFor="quick-role">{tr('account.role')}</label>
              <input
                id="quick-role"
                className="input"
                value={quickProfile.role}
                onChange={e => setQuickProfile(p => ({ ...p, role: e.target.value }))}
                maxLength={100}
                placeholder={tr('account.role_placeholder')}
              />
              <label className="field-label" htmlFor="quick-picture">{tr('account.picture')}</label>
              <input
                id="quick-picture"
                className="input"
                value={quickProfile.picture}
                onChange={e => setQuickProfile(p => ({ ...p, picture: e.target.value }))}
                maxLength={500}
                placeholder={tr('account.picture_placeholder')}
              />
              <div className="avatar-upload-row compact">
                <label className="btn small" htmlFor="quick-avatar-file">
                  {quickAvatarUploading ? tr('account.uploading_avatar') : tr('account.upload_avatar')}
                </label>
                <input
                  id="quick-avatar-file"
                  className="visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={quickAvatarUploading}
                  onChange={(e) => uploadQuickAvatar(e.target.files?.[0])}
                />
              </div>
              {quickMsg && <div className={`form-msg ${quickMsg.includes('✓') ? 'ok' : ''}`}>{quickMsg}</div>}
              <button className="btn primary small" onClick={saveQuickAccount} disabled={quickSaving}>
                {quickSaving ? tr('account.saving') : tr('account.save_profile')}
              </button>
            </div>
          )}
          <div className="side-controls">
            <button
              className="side-ctrl icon-only"
              onClick={toggleTheme}
              title={theme === 'dark' ? tr('theme.to_light') : tr('theme.to_dark')}
              aria-label={theme === 'dark' ? tr('theme.to_light') : tr('theme.to_dark')}
            >
              {theme === 'dark' ? SUN : MOON}
            </button>
            <button
              className="side-ctrl"
              onClick={toggleLang}
              title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
            >
              {GLOBE}<span>{lang === 'vi' ? 'EN' : 'VI'}</span>
            </button>
            <button
              className="side-logout"
              onClick={handleLogout}
              title={tr('nav.logout')}
              aria-label={tr('nav.logout')}
            >
              {LOGOUT_ICON}
            </button>
          </div>
        </div>
      </aside>
      <main className="content">
        <header className={`app-header${headerScrolled ? ' scrolled' : ''}`}>
          <span className="app-header-title">{pageTitle}</span>
          <div className="app-header-actions">
            <CycleSelector />
            <NotificationsBell />
            <button
              className="app-header-btn icon-only"
              onClick={() => setShowOnboardingHelp(true)}
              title="Help → Xem lại hướng dẫn"
              aria-label="Help - Xem lại hướng dẫn"
            >
              {HELP_ICON}
            </button>
            <button
              className="app-header-btn icon-only header-mobile-only"
              onClick={toggleTheme}
              title={theme === 'dark' ? tr('theme.to_light') : tr('theme.to_dark')}
              aria-label={theme === 'dark' ? tr('theme.to_light') : tr('theme.to_dark')}
            >
              {theme === 'dark' ? SUN : MOON}
            </button>
            <button
              className="app-header-btn header-mobile-only"
              onClick={toggleLang}
              title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
            >
              {GLOBE}<span>{lang === 'vi' ? 'EN' : 'VI'}</span>
            </button>
            <button
              className="app-header-btn icon-only header-mobile-only"
              onClick={handleLogout}
              title={tr('nav.logout')}
              aria-label={tr('nav.logout')}
            >
              {LOGOUT_ICON}
            </button>
          </div>
        </header>
        <div className="content-body" ref={mainRef}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/kpis" element={<Kpis />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/settings" element={<Settings user={user} onUserUpdate={handleUserUpdate} />} />
          </Routes>
        </div>
        <footer className="app-footer">
          <div className="app-footer-inner">
            <div className="app-footer-brand">
              <span className="app-footer-dot" aria-hidden="true" />
              <strong>{tr('app.title')}</strong>
              <span className="app-footer-tagline">{tr('footer.tagline')}</span>
            </div>
            <div className="app-footer-meta">
              <span>{tr('footer.privacy')}</span>
              <span className="app-footer-sep">·</span>
              <span>{tr('footer.made')}</span>
              <span className="app-footer-sep">·</span>
              <span>© {new Date().getFullYear()}</span>
            </div>
          </div>
        </footer>
        <HelpPanel
          targetRef={mainRef}
          screenName={pageTitle}
          position="right"
        />
      </main>
    </div>
  )
}

export default function App() {
  // D5: Route /shared/:token không cần login (phải check trước các provider)
  if (window.location.pathname.startsWith('/shared/')) {
    return <SharedReportRoute />
  }
  return (
    <ThemeProvider>
      <ViewProvider>
        <LangProvider>
          <CycleProvider>
            <ToastProvider>
              <AppContent />
            </ToastProvider>
          </CycleProvider>
        </LangProvider>
      </ViewProvider>
    </ThemeProvider>
  )
}
