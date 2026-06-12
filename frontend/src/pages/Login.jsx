import { useState, useEffect } from 'react'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { api } from '../api'

export default function Login({ onLogin }) {
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
    if (!e) return 'Vui lòng nhập email'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'Email không đúng định dạng'
    if (!password) return 'Vui lòng nhập mật khẩu'
    if (mode === 'register' && password.length < 6) return 'Mật khẩu tối thiểu 6 ký tự'
    if (mode === 'register' && /[<>"'/\\&{}]/.test(name)) return 'Tên chứa ký tự không hợp lệ'
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
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1e40af' }}>KPI Companion</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Trợ lý KPI cá nhân</div>
        </div>

        {/* Google OAuth button */}
        {googleClientId && (
          <GoogleOAuthProvider clientId={googleClientId}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Đăng nhập Google thất bại')}
                text="signin_with"
                shape="rectangular"
                locale="vi"
                width="308"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>hoặc đăng nhập bằng email</span>
              <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
            </div>
          </GoogleOAuthProvider>
        )}

        {/* Email / Password tabs */}
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
              {m === 'login' ? 'Đăng nhập' : 'Đăng ký'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'register' && (
            <div>
              <label style={labelStyle}>Tên hiển thị</label>
              <input type="text" placeholder="Nguyễn Văn A" value={name}
                onChange={e => setName(e.target.value)} style={inputStyle} />
            </div>
          )}
          <div>
            <label style={labelStyle}>Email</label>
            <input type="text" placeholder="ten@vng.com.vn hoặc @gmail.com"
              value={email} onChange={e => setEmail(e.target.value)}
              autoFocus={!googleClientId} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Mật khẩu</label>
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
            {loading ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
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
