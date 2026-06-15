import { useState, useEffect } from 'react'
import { useLang } from '../LangContext'
import { useTheme } from '../ThemeContext'
import { prefs, EXPORT_FORMATS, EXPORT_SECTIONS } from '../prefs'
import { ConfirmModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { api } from '../api'

function PasswordInput({ id, label, value, onChange, visible, onToggle, autoComplete, showLabel, hideLabel }) {
  return (
    <>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="password-input-wrap">
        <input
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
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
    </>
  )
}

export default function Settings({ user, onUserUpdate }) {
  const { tr, lang, setLangDirect } = useLang()
  const { themeMode, setThemeMode } = useTheme()
  const toast = useToast()

  // Lưu giá trị gốc khi vào trang để so sánh dirty
  const [originalTheme, setOriginalTheme] = useState(themeMode)
  const [originalLang, setOriginalLang] = useState(lang)

  // Pending states - cho AI & Export (chỉ lưu khi bấm nút tổng)
  const [pendingAutoCoach, setPendingAutoCoach] = useState(prefs.getAutoCoach())
  const [pendingFmts, setPendingFmts] = useState(prefs.getExportFormats())
  const [pendingSecs, setPendingSecs] = useState(prefs.getExportSections())
  const [pendingMgrChannel, setPendingMgrChannel] = useState(prefs.getMgrChannel())
  const [pendingMgrTo, setPendingMgrTo] = useState(prefs.getMgrRecipient())

  // Dirty: so sánh với giá trị gốc (đã apply) và prefs
  const dirty = originalTheme !== themeMode ||
    originalLang !== lang ||
    pendingAutoCoach !== prefs.getAutoCoach() ||
    JSON.stringify(pendingFmts) !== JSON.stringify(prefs.getExportFormats()) ||
    JSON.stringify(pendingSecs) !== JSON.stringify(prefs.getExportSections()) ||
    pendingMgrChannel !== prefs.getMgrChannel() ||
    pendingMgrTo.trim() !== prefs.getMgrRecipient()

  const [saved, setSaved] = useState('')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const flash = (msg) => { setSaved(msg); toast.success(msg); setTimeout(() => setSaved(''), 1800) }
  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileRole, setProfileRole] = useState(user?.role || '')
  const [profilePicture, setProfilePicture] = useState(user?.picture || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accountSaving, setAccountSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [accountMsg, setAccountMsg] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // D2: Notification settings
  const [notifSettings, setNotifSettings] = useState(null)
  const [notifEmail, setNotifEmail] = useState('')
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifMsg, setNotifMsg] = useState('')

  useEffect(() => {
    api.getNotificationSettings().then(s => {
      setNotifSettings(s)
      setNotifEmail(s.recipient_email || '')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setProfileName(user?.name || '')
    setProfileRole(user?.role || '')
    setProfilePicture(user?.picture || '')
  }, [user?.name, user?.role, user?.picture])

  const saveNotifSettings = async () => {
    if (!notifSettings) return
    setNotifSaving(true)
    try {
      const updated = await api.updateNotificationSettings({
        ...notifSettings,
        recipient_email: notifEmail.trim(),
      })
      setNotifSettings(updated)
      flash('Đã lưu cài đặt thông báo')
    } catch (e) { setNotifMsg(e.message) } finally { setNotifSaving(false) }
  }

  const toggleNotif = (key) => {
    setNotifSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const sendTestEmail = async () => {
    setNotifMsg('')
    try {
      const r = await api.sendTestEmail()
      setNotifMsg(r.message)
    } catch (e) { setNotifMsg(e.message) }
  }

  const saveProfile = async () => {
    setAccountMsg('')
    const name = profileName.trim()
    if (!name) {
      setAccountMsg(tr('account.name_required'))
      return
    }
    setAccountSaving(true)
    try {
      const updated = await api.updateMe({
        name,
        role: profileRole.trim(),
        picture: profilePicture.trim(),
      })
      onUserUpdate?.(updated)
      setAccountMsg(tr('account.profile_saved'))
      flash(tr('settings.saved'))
    } catch (e) {
      setAccountMsg(e.message)
    } finally {
      setAccountSaving(false)
    }
  }

  const uploadProfileAvatar = async (file) => {
    if (!file) return
    setAccountMsg('')
    setAvatarUploading(true)
    try {
      const updated = await api.uploadAvatar(file)
      setProfilePicture(updated.picture || '')
      onUserUpdate?.(updated)
      setAccountMsg(tr('account.avatar_uploaded'))
      flash(tr('settings.saved'))
    } catch (e) {
      setAccountMsg(e.message)
    } finally {
      setAvatarUploading(false)
    }
  }

  const savePassword = async () => {
    setPasswordMsg('')
    if (newPassword !== confirmPassword) {
      setPasswordMsg(tr('account.password_mismatch'))
      return
    }
    if (newPassword.length < 6) {
      setPasswordMsg(tr('account.password_rule_min'))
      return
    }
    if (newPassword.length > 100) {
      setPasswordMsg(tr('account.password_rule_max'))
      return
    }
    if (currentPassword && newPassword === currentPassword) {
      setPasswordMsg(tr('account.password_same'))
      return
    }
    setPasswordSaving(true)
    try {
      await api.updatePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMsg(tr('account.password_saved'))
      flash(tr('settings.saved'))
    } catch (e) {
      setPasswordMsg(e.message)
    } finally {
      setPasswordSaving(false)
    }
  }

  // Theme/Lang preview ngay, Lưu để persist
  const applyTheme = (v) => { setThemeMode(v) }
  const applyLang = (v) => { setLangDirect(v) }

  const saveAll = () => {
    prefs.setAutoCoach(pendingAutoCoach)
    prefs.setExportFormats(pendingFmts)
    prefs.setExportSections(pendingSecs)
    prefs.setMgrChannel(pendingMgrChannel)
    prefs.setMgrRecipient(pendingMgrTo.trim())
    setOriginalTheme(themeMode)
    setOriginalLang(lang)
    setPendingMgrTo(pendingMgrTo.trim())
    flash(tr('settings.saved'))
  }

  const toggleAutoCoach = () => setPendingAutoCoach(!pendingAutoCoach)
  const toggleFmt = (k) => {
    const next = pendingFmts.includes(k) ? pendingFmts.filter((x) => x !== k) : [...pendingFmts, k]
    setPendingFmts(next)
  }
  const toggleSec = (k) => {
    const next = pendingSecs.includes(k) ? pendingSecs.filter((x) => x !== k) : [...pendingSecs, k]
    setPendingSecs(next)
  }

  const doResetAll = () => {
    prefs.reset()
    setPendingAutoCoach(prefs.getAutoCoach())
    setPendingFmts(prefs.getExportFormats())
    setPendingSecs(prefs.getExportSections())
    setPendingMgrChannel(prefs.getMgrChannel())
    setPendingMgrTo(prefs.getMgrRecipient())
    setShowResetConfirm(false)
    flash(tr('settings.reset_done'))
  }

  const Switch = ({ on, onClick }) => (
    <button className={`switch ${on ? 'on' : ''}`} onClick={onClick} role="switch" aria-checked={on}>
      <span className="switch-knob" />
    </button>
  )

  const PasswordInputLocal = ({ id, label, value, onChange, visible, onToggle, autoComplete }) => (
    <>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="password-input-wrap">
        <input
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
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
    </>
  )

  return (
    <div className="page settings-page">
      <header className="page-header row">
        <div>
          <h1>{tr('settings.title')}</h1>
          <p>{tr('settings.subtitle')}</p>
        </div>
        {saved && <span className="settings-saved">{saved}</span>}
      </header>

      {/* Tai khoan */}
      <div className="card">
        <h3>{tr('account.section')}</h3>
        <div className="account-grid">
          <div>
            <div className="setting-label">{tr('account.profile')}</div>
            <div className="muted setting-hint">{user?.email || ''}</div>
          </div>
          <div className="account-form">
            <label className="field-label" htmlFor="profile-name">{tr('account.name')}</label>
            <input
              id="profile-name"
              className="input"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              maxLength={100}
            />
            <label className="field-label" htmlFor="profile-role">{tr('account.role')}</label>
            <input
              id="profile-role"
              className="input"
              value={profileRole}
              onChange={(e) => setProfileRole(e.target.value)}
              maxLength={100}
              placeholder={tr('account.role_placeholder')}
            />
            <label className="field-label" htmlFor="profile-picture">{tr('account.picture')}</label>
            <div className="avatar-edit-row">
              {profilePicture
                ? <img className="account-avatar-preview" src={profilePicture} alt="" referrerPolicy="no-referrer" />
                : <div className="account-avatar-preview placeholder">{(profileName || '?')[0].toUpperCase()}</div>
              }
              <input
                id="profile-picture"
                className="input"
                value={profilePicture}
                onChange={(e) => setProfilePicture(e.target.value)}
                maxLength={500}
                placeholder={tr('account.picture_placeholder')}
              />
            </div>
            <div className="avatar-upload-row">
              <label className="btn small" htmlFor="profile-avatar-file">
                {avatarUploading ? tr('account.uploading_avatar') : tr('account.upload_avatar')}
              </label>
              <input
                id="profile-avatar-file"
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={avatarUploading}
                onChange={(e) => uploadProfileAvatar(e.target.files?.[0])}
              />
              <span className="muted setting-hint">{tr('account.avatar_upload_hint')}</span>
            </div>
            {accountMsg && <div className={`form-msg ${accountMsg.includes('✓') ? 'ok' : ''}`}>{accountMsg}</div>}
            <button
              className="btn primary small"
              onClick={saveProfile}
              disabled={accountSaving || (
                profileName.trim() === (user?.name || '') &&
                profileRole.trim() === (user?.role || '') &&
                profilePicture.trim() === (user?.picture || '')
              )}
            >
              {accountSaving ? tr('account.saving') : tr('account.save_profile')}
            </button>
          </div>
        </div>
        <div className="account-grid no-border">
          <div>
            <div className="setting-label">{tr('account.password')}</div>
            <div className="muted setting-hint">{tr('account.password_hint')}</div>
            <div className="password-rules">{tr('account.password_rules')}</div>
          </div>
          <div className="account-form">
            <PasswordInput
              id="current-password"
              label={tr('account.current_password')}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              visible={showCurrentPassword}
              onToggle={() => setShowCurrentPassword(v => !v)}
              autoComplete="current-password"
              showLabel={tr('password.show')}
              hideLabel={tr('password.hide')}
            />
            <PasswordInput
              id="new-password"
              label={tr('account.new_password')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              visible={showNewPassword}
              onToggle={() => setShowNewPassword(v => !v)}
              autoComplete="new-password"
              showLabel={tr('password.show')}
              hideLabel={tr('password.hide')}
            />
            <PasswordInput
              id="confirm-password"
              label={tr('account.confirm_password')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              visible={showConfirmPassword}
              onToggle={() => setShowConfirmPassword(v => !v)}
              autoComplete="new-password"
              showLabel={tr('password.show')}
              hideLabel={tr('password.hide')}
            />
            {passwordMsg && <div className={`form-msg ${passwordMsg.includes('✓') ? 'ok' : ''}`}>{passwordMsg}</div>}
            <button className="btn primary small" onClick={savePassword} disabled={passwordSaving || !newPassword || !confirmPassword}>
              {passwordSaving ? tr('account.saving') : tr('account.save_password')}
            </button>
          </div>
        </div>
      </div>

      {/* Giao dien & Ngon ngu */}
      <div className="card">
        <h3>{tr('settings.appearance')}</h3>
        <div className="setting-row">
          <div className="setting-label">{tr('settings.theme')}</div>
          <div className="seg">
            <button className={`seg-btn ${themeMode === 'light' ? 'active' : ''}`} onClick={() => applyTheme('light')}>☀️ {tr('theme.light')}</button>
            <button className={`seg-btn ${themeMode === 'dark' ? 'active' : ''}`} onClick={() => applyTheme('dark')}>🌙 {tr('theme.dark')}</button>
            <button className={`seg-btn ${themeMode === 'system' ? 'active' : ''}`} onClick={() => applyTheme('system')}>🖥️ {tr('theme.system')}</button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-label">{tr('settings.language')}</div>
          <div className="seg">
            <button className={`seg-btn ${lang === 'vi' ? 'active' : ''}`} onClick={() => applyLang('vi')}>Tiếng Việt</button>
            <button className={`seg-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => applyLang('en')}>English</button>
          </div>
        </div>
      </div>

      {/* Tro ly AI */}
      <div className="card">
        <h3>{tr('settings.ai_section')}</h3>
        <div className="setting-row">
          <div>
            <div className="setting-label">{tr('settings.autocoach')}</div>
            <div className="muted setting-hint">{tr('settings.autocoach_hint')}</div>
          </div>
          <Switch on={pendingAutoCoach} onClick={toggleAutoCoach} />
        </div>
      </div>

      {/* Export mac dinh */}
      <div className="card">
        <h3>{tr('settings.export_section')}</h3>
        <p className="muted setting-hint">{tr('settings.export_hint')}</p>
        <div className="setting-row">
          <div className="setting-label">{tr('export.formats_label')}</div>
          <div className="export-chips">
            {EXPORT_FORMATS.map(([k, label]) => (
              <button key={k} className={`export-chip ${pendingFmts.includes(k) ? 'active' : ''}`} onClick={() => toggleFmt(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-label">{tr('export.sections_label')}</div>
          <div className="export-chips">
            {EXPORT_SECTIONS.map(([k, lk]) => (
              <button key={k} className={`export-chip ${pendingSecs.includes(k) ? 'active' : ''}`} onClick={() => toggleSec(k)}>{tr(lk)}</button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-label">{tr('settings.mgr_default')}</div>
          <div className="export-row" style={{ margin: 0, flex: 1 }}>
            <select value={pendingMgrChannel} onChange={(e) => setPendingMgrChannel(e.target.value)} className="forecast-select" style={{ maxWidth: 130 }}>
              <option value="email">{tr('export.channel_email')}</option>
              <option value="webhook">{tr('export.channel_webhook')}</option>
            </select>
            <input className="export-recipient" placeholder={pendingMgrChannel === 'email' ? tr('export.recipient_ph_email') : tr('export.recipient_ph_webhook')}
              value={pendingMgrTo} onChange={(e) => setPendingMgrTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* D2: Notification settings */}
      <div className="card">
        <h3>Thông báo email</h3>
        <p className="muted setting-hint">Cấu hình email nhắc nhở tự động. Yêu cầu SMTP_EMAIL và SMTP_PASSWORD trong file .env.</p>
        {notifSettings ? (
          <>
            <div className="notif-toggle-row">
              <div className="notif-toggle-info">
                <div className="notif-toggle-label">Nhắc nhở KPI</div>
                <div className="notif-toggle-desc">Thứ Sáu hàng tuần — khi có KPI chưa cập nhật trong 5 ngày</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={notifSettings.kpi_reminder_enabled}
                  onChange={() => toggleNotif('kpi_reminder_enabled')} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="notif-toggle-row">
              <div className="notif-toggle-info">
                <div className="notif-toggle-label">Tóm tắt tuần</div>
                <div className="notif-toggle-desc">Thứ Hai hàng tuần — tổng quan KPI đạt/chưa đạt</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={notifSettings.weekly_summary_enabled}
                  onChange={() => toggleNotif('weekly_summary_enabled')} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="notif-toggle-row">
              <div className="notif-toggle-info">
                <div className="notif-toggle-label">Lỗi đồng bộ</div>
                <div className="notif-toggle-desc">Ngay khi job đồng bộ dữ liệu thất bại liên tiếp ≥ 2 lần</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={notifSettings.sync_error_enabled}
                  onChange={() => toggleNotif('sync_error_enabled')} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-row" style={{ marginTop: 12 }}>
              <div className="setting-label">Email nhận thông báo</div>
              <input
                placeholder="Để trống = dùng email tài khoản"
                value={notifEmail}
                onChange={e => setNotifEmail(e.target.value)}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
              />
            </div>
            {notifMsg && <div style={{ fontSize: 13, color: notifMsg.startsWith('Đã') ? '#16a34a' : '#dc2626', marginTop: 8 }}>{notifMsg}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary small" onClick={saveNotifSettings} disabled={notifSaving}>
                {notifSaving ? 'Đang lưu...' : 'Lưu cài đặt'}
              </button>
              <button className="btn small" onClick={sendTestEmail}>Gửi email thử</button>
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>Đang tải...</div>
        )}
      </div>

      <div className="card">
        <h3>{tr('settings.reset_section')}</h3>
        <div className="setting-row">
          <div className="muted setting-hint">{tr('settings.reset_hint')}</div>
          <button className="btn danger" onClick={() => setShowResetConfirm(true)}>{tr('settings.reset_btn')}</button>
        </div>
      </div>

      {/* Nut Luu tong */}
      <div className="settings-footer">
        <button className={`btn primary${dirty ? '' : ' muted'}`} onClick={saveAll} disabled={!dirty}>
          {tr('settings.save_all')}
        </button>
      </div>

      <ConfirmModal
        open={showResetConfirm}
        title={tr('settings.reset_btn')}
        message={tr('settings.reset_confirm')}
        confirmLabel={tr('settings.reset_btn')}
        confirmVariant="danger"
        onConfirm={doResetAll}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  )
}
