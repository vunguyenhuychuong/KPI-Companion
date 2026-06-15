import { useState, useEffect } from 'react'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { api } from '../api'
import { useLang } from '../LangContext'

function PasswordField({ id, label, value, onChange, visible, onToggle, placeholder = '', showLabel, hideLabel }) {
  return (
    <div>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      <div className="password-input-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          style={{ ...inputStyle, paddingRight: 44 }}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={onToggle}
          title={visible ? hideLabel : showLabel}
          aria-label={visible ? hideLabel : showLabel}
        >
          {visible ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  )
}

export default function Login({ onLogin }) {
  const { tr } = useLang()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetInfo, setResetInfo] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleClientId, setGoogleClientId] = useState('')

  useEffect(() => {
    api.authConfig()
      .then(d => setGoogleClientId(d.google_client_id || ''))
      .catch(() => {})
    const token = new URLSearchParams(window.location.search).get('reset_token')
    if (token) {
      setMode('reset')
      setResetToken(token)
    }
  }, [])

  function saveAndLogin(data) {
    const user = {
      id: data.user_id,
      name: data.name,
      email: data.email || '',
      role: data.role || '',
      picture: data.picture || '',
      onboarding_completed: data.onboarding_completed,
    }
    localStorage.setItem('kpi_token', data.access_token)
    localStorage.setItem('kpi_user', JSON.stringify(user))
    onLogin(user)
  }

  function clientValidate() {
    if (mode === 'forgot') {
      const e = email.trim()
      if (!e) return tr('login.err_email_empty')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return tr('login.err_email_format')
      return null
    }
    if (mode === 'reset') {
      if (!resetToken.trim()) return tr('login.reset_token_required')
      if (!resetPassword) return tr('login.err_password_empty')
      if (resetPassword.length < 6) return tr('login.err_password_short')
      if (resetPassword.length > 100) return tr('account.password_rule_max')
      if (resetPassword !== resetConfirm) return tr('account.password_mismatch')
      return null
    }
    const e = email.trim()
    if (!e) return tr('login.err_email_empty')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return tr('login.err_email_format')
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
      if (mode === 'forgot') {
        const data = await api.forgotPassword(email.trim())
        setResetInfo(data.mocked && data.reset_token
          ? `${data.message} ${tr('login.reset_demo_token')}: ${data.reset_token}`
          : data.message)
        if (data.reset_token) {
          setResetToken(data.reset_token)
          setMode('reset')
        }
      } else if (mode === 'reset') {
        await api.resetPassword(resetToken.trim(), resetPassword)
        setResetInfo(tr('login.reset_done'))
        setPassword('')
        setResetPassword('')
        setResetConfirm('')
        setMode('login')
      } else {
        const data = mode === 'login'
          ? await api.login(email.trim(), password)
          : await api.register(email.trim(), password, name.trim())
        saveAndLogin(data)
      }
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

  const PasswordFieldLocal = ({ id, label, value, onChange, visible, onToggle, placeholder = '' }) => (
    <div>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      <div className="password-input-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          style={{ ...inputStyle, paddingRight: 44 }}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={onToggle}
          title={visible ? tr('password.hide') : tr('password.show')}
          aria-label={visible ? tr('password.hide') : tr('password.show')}
        >
          {visible ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #1e40af 0%, #1d4ed8 50%, #2563eb 100%)',
    }}>
      <div style={{
        background: 'var(--card)', borderRadius: 16, padding: '40px 36px', width: 380,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎯</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>{tr('app.title')}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{tr('login.subtitle')}</div>
        </div>

        {googleClientId && mode !== 'forgot' && mode !== 'reset' && (
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
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{tr('login.google_divider')}</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
          </GoogleOAuthProvider>
        )}

        {mode !== 'forgot' && mode !== 'reset' && (
        <div style={{ display: 'flex', marginBottom: 24, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {['login', 'register'].map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError('') }}
              style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: 14,
                background: mode === m ? '#2563eb' : 'var(--surface-2)',
                color: mode === m ? '#fff' : 'var(--text)',
                transition: 'all 0.15s',
              }}
            >
              {m === 'login' ? tr('login.tab_login') : tr('login.tab_register')}
            </button>
          ))}
        </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'register' && (
            <div>
              <label style={labelStyle}>{tr('login.name_label')}</label>
              <input type="text" placeholder={tr('login.name_placeholder')} value={name}
                onChange={e => setName(e.target.value)} style={inputStyle} />
            </div>
          )}
          {mode !== 'reset' && (
          <div>
            <label style={labelStyle}>{tr('login.email_label')}</label>
            <input type="text" placeholder={tr('login.email_placeholder')}
              value={email} onChange={e => setEmail(e.target.value)}
              autoFocus={!googleClientId} style={inputStyle} />
          </div>
          )}
          {(mode === 'login' || mode === 'register') && (
          <PasswordField
            id="login-password"
            label={tr('login.password_label')}
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            visible={showPassword}
            onToggle={() => setShowPassword(v => !v)}
            showLabel={tr('password.show')}
            hideLabel={tr('password.hide')}
          />
          )}

          {mode === 'reset' && (
            <>
              <div>
                <label style={labelStyle}>{tr('login.reset_token')}</label>
                <input type="text" value={resetToken} onChange={e => setResetToken(e.target.value)} style={inputStyle} />
              </div>
              <PasswordField
                id="reset-password"
                label={tr('account.new_password')}
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                visible={showResetPassword}
                onToggle={() => setShowResetPassword(v => !v)}
                showLabel={tr('password.show')}
                hideLabel={tr('password.hide')}
              />
              <PasswordField
                id="reset-confirm-password"
                label={tr('account.confirm_password')}
                value={resetConfirm}
                onChange={e => setResetConfirm(e.target.value)}
                visible={showResetConfirm}
                onToggle={() => setShowResetConfirm(v => !v)}
                showLabel={tr('password.show')}
                hideLabel={tr('password.hide')}
              />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('account.password_rules')}</div>
            </>
          )}

          {error && (
            <div style={{
              background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.35)', borderRadius: 8,
              padding: '10px 14px', color: '#dc2626', fontSize: 13,
            }}>
              {error}
            </div>
          )}
          {resetInfo && (
            <div style={{
              background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.35)', borderRadius: 8,
              padding: '10px 14px', color: '#15803d', fontSize: 13, wordBreak: 'break-word',
            }}>
              {resetInfo}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '12px 0', borderRadius: 8, border: 'none',
            background: loading ? '#93c5fd' : '#2563eb', color: '#fff',
            fontWeight: 700, fontSize: 15, cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}>
            {loading ? tr('login.loading')
              : mode === 'login' ? tr('login.submit_login')
                : mode === 'register' ? tr('login.submit_register')
                  : mode === 'forgot' ? tr('login.forgot_submit')
                    : tr('login.reset_submit')}
          </button>
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setResetInfo('') }}
            style={{ border: 'none', background: 'transparent', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
          >
            {mode === 'login' ? tr('login.forgot_link') : tr('login.back_to_login')}
          </button>
        </form>

        {mode === 'login' && (
          <div style={{ marginTop: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
            Demo: <strong>demo@demo.com</strong> / <strong>demo1234</strong>
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6,
}

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--border)', fontSize: 14, outline: 'none',
  boxSizing: 'border-box', transition: 'border-color 0.15s',
  background: 'var(--surface)', color: 'var(--text)',
}
