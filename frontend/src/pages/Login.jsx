import { useState, useEffect } from 'react'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { api } from '../api'
import { useLang } from '../LangContext'

export default function Login({ onLogin }) {
  const { tr } = useLang()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleClientId, setGoogleClientId] = useState('')

  useEffect(() => {
    api.authConfig()
      .then(d => setGoogleClientId(d.google_client_id || ''))
      .catch(() => {})
  }, [])

  function saveAndLogin(data) {
    localStorage.setItem('kpi_token', data.access_token)
    localStorage.setItem('kpi_user', JSON.stringify({
      id: data.user_id, name: data.name, picture: data.picture || '',
    }))
    onLogin({ id: data.user_id, name: data.name, picture: data.picture || '' })
  }

  function clientValidate() {
    const e = email.trim()
    if (!e) return tr('login.err_email_empty')
    if (mode === 'register' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return tr('login.err_email_format')
    if (!password) return tr('login.err_password_empty')
    if (mode === 'register' && password.length < 6) return tr('login.err_password_short')
    if (mode === 'register' && /[<>"'/\\&{}]/.test(name)) return tr('login.err_name_invalid')
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const clientErr = clientValidate()
    if (clientErr) { setError(clientErr); return }
    setLoading(true)
    try {
      const data = mode === 'login'
        ? await api.login(email.trim(), password)
        : await api.register(email.trim(), password, name.trim())
      saveAndLogin(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSuccess(response) {
    setError('')
    try {
      const data = await api.googleLogin(response.credential)
      saveAndLogin(data)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #1e40af 0%, #1d4ed8 50%, #2563eb 100%)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 36px', width: 380,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎯</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1e40af' }}>{tr('app.title')}</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{tr('login.subtitle')}</div>
        </div>

        {googleClientId && (
          <GoogleOAuthProvider clientId={googleClientId}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError(tr('login.google_error'))}
                text="signin_with"
                shape="rectangular"
                locale="vi"
                width="308"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>{tr('login.google_divider')}</span>
              <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
            </div>
          </GoogleOAuthProvider>
        )}

        <div style={{ display: 'flex', marginBottom: 24, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
          {['login', 'register'].map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError('') }}
              style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: 14,
                background: mode === m ? '#2563eb' : '#f9fafb',
                color: mode === m ? '#fff' : '#374151',
                transition: 'all 0.15s',
              }}
            >
              {m === 'login' ? tr('login.tab_login') : tr('login.tab_register')}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'register' && (
            <div>
              <label style={labelStyle}>{tr('login.name_label')}</label>
              <input type="text" placeholder={tr('login.name_placeholder')} value={name}
                onChange={e => setName(e.target.value)} style={inputStyle} />
            </div>
          )}
          <div>
            <label style={labelStyle}>{tr('login.email_label')}</label>
            <input type="text" placeholder={tr('login.email_placeholder')}
              value={email} onChange={e => setEmail(e.target.value)}
              autoFocus={!googleClientId} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{tr('login.password_label')}</label>
            <input type="password" placeholder="••••••••" value={password}
              onChange={e => setPassword(e.target.value)} style={inputStyle} />
          </div>

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
              padding: '10px 14px', color: '#dc2626', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '12px 0', borderRadius: 8, border: 'none',
            background: loading ? '#93c5fd' : '#2563eb', color: '#fff',
            fontWeight: 700, fontSize: 15, cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}>
            {loading ? tr('login.loading') : mode === 'login' ? tr('login.submit_login') : tr('login.submit_register')}
          </button>
        </form>

        {mode === 'login' && (
          <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 8, fontSize: 12, color: '#0369a1' }}>
            Demo: <strong>demo@local</strong> / <strong>demo</strong>
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6,
}

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid #d1d5db', fontSize: 14, outline: 'none',
  boxSizing: 'border-box', transition: 'border-color 0.15s',
}
