import { useState, useEffect } from 'react'
import { useLang } from '../LangContext'
import { useTheme } from '../ThemeContext'
import { prefs } from '../prefs'
import { ConfirmModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { api } from '../api'
import { UiIcon, cleanIconLabel } from '../components/UiIcon'

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
          <UiIcon name={visible ? 'eyeOff' : 'eye'} />
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

  // Dirty: so sánh với giá trị gốc (đã apply) và prefs
  const dirty = originalTheme !== themeMode ||
    originalLang !== lang ||
    pendingAutoCoach !== prefs.getAutoCoach()

  const [saved, setSaved] = useState('')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const flash = (msg) => { setSaved(msg); toast.success(msg); setTimeout(() => setSaved(''), 1800) }
  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileRole, setProfileRole] = useState(user?.role || '')
  const [profileDepartment, setProfileDepartment] = useState(user?.department || '')
  const [profileEmployeeCode, setProfileEmployeeCode] = useState(user?.employee_code || '')
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
  const [notifOk, setNotifOk] = useState(false)
  const [brainStatus, setBrainStatus] = useState(null)
  const [brainSettings, setBrainSettings] = useState(null)
  const [brainSaving, setBrainSaving] = useState(false)
  const [brainMsg, setBrainMsg] = useState('')

  useEffect(() => {
    api.getNotificationSettings().then(s => {
      setNotifSettings(s)
      setNotifEmail(s.recipient_email || '')
    }).catch(() => {})
    api.brainStatus().then(s => {
      setBrainStatus(s)
      setBrainSettings(s.settings)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setProfileName(user?.name || '')
    setProfileRole(user?.role || '')
    setProfileDepartment(user?.department || '')
    setProfileEmployeeCode(user?.employee_code || '')
    setProfilePicture(user?.picture || '')
  }, [user?.name, user?.role, user?.department, user?.employee_code, user?.picture])

  const saveNotifSettings = async () => {
    if (!notifSettings) return
    setNotifSaving(true)
    try {
      const updated = await api.updateNotificationSettings({
        ...notifSettings,
        recipient_email: notifEmail.trim(),
      })
      setNotifSettings(updated)
      flash(tr('settings.notif_saved'))
    } catch (e) { setNotifMsg(e.message); setNotifOk(false) } finally { setNotifSaving(false) }
  }

  const toggleNotif = (key) => {
    setNotifSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const setBrain = (key, value) => {
    setBrainSettings(prev => ({ ...(prev || {}), [key]: value }))
  }

  const saveBrainSettings = async () => {
    if (!brainSettings) return
    setBrainSaving(true)
    setBrainMsg('')
    try {
      const updated = await api.updateBrainSettings(brainSettings)
      setBrainSettings(updated)
      const status = await api.brainStatus()
      setBrainStatus(status)
      setBrainMsg(tr('settings.brain_saved'))
      flash(tr('settings.saved'))
    } catch (e) {
      setBrainMsg(e.message)
    } finally {
      setBrainSaving(false)
    }
  }

  const cleanupBrainHistory = async () => {
    setBrainSaving(true)
    setBrainMsg('')
    try {
      const res = await api.cleanupBrainRetention()
      setBrainMsg(tr('settings.brain_cleanup_done', { count: res.deleted || 0 }))
    } catch (e) {
      setBrainMsg(e.message)
    } finally {
      setBrainSaving(false)
    }
  }

  const sendTestEmail = async () => {
    setNotifMsg('')
    setNotifOk(false)
    try {
      await api.sendTestEmail()
      setNotifMsg(tr('settings.notif_test_sent'))
      setNotifOk(true)
    } catch (e) { setNotifMsg(e.message); setNotifOk(false) }
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
        department: profileDepartment.trim(),
        employee_code: profileEmployeeCode.trim(),
        preferred_language: lang,
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

  const saveAll = async () => {
    prefs.setAutoCoach(pendingAutoCoach)
    if (originalLang !== lang && user?.name) {
      try {
        const updated = await api.updateMe({
          name: user.name,
          role: user.role || '',
          department: user.department || '',
          employee_code: user.employee_code || '',
          preferred_language: lang,
          picture: user.picture || '',
        })
        onUserUpdate?.(updated)
      } catch (e) {
        setAccountMsg(e.message)
        return
      }
    }
    setOriginalTheme(themeMode)
    setOriginalLang(lang)
    flash(tr('settings.saved'))
  }

  const toggleAutoCoach = () => setPendingAutoCoach(!pendingAutoCoach)

  const doResetAll = () => {
    prefs.reset()
    setPendingAutoCoach(prefs.getAutoCoach())
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
          <UiIcon name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>
    </>
  )

  return (
    <div className="page settings-page">
      <header className="page-header row">
        <div>
          <h1 className="page-title-with-icon"><UiIcon name="settings" /> {cleanIconLabel(tr('settings.title'))}</h1>
          <p>{tr('settings.subtitle')}</p>
        </div>
        {saved && <span className="settings-saved">{saved}</span>}
      </header>

      <div className="settings-layout">
        <div className="settings-main-column">
      {/* Giao dien & Ngon ngu */}
      <div className="card settings-card settings-appearance-card">
        <h3 className="icon-heading"><UiIcon name="palette" /> {cleanIconLabel(tr('settings.appearance'))}</h3>
        <div className="setting-row">
          <div className="setting-label">{tr('settings.theme')}</div>
          <div className="seg">
            <button className={`seg-btn ${themeMode === 'light' ? 'active' : ''}`} onClick={() => applyTheme('light')}><UiIcon name="sun" />{tr('theme.light')}</button>
            <button className={`seg-btn ${themeMode === 'dark' ? 'active' : ''}`} onClick={() => applyTheme('dark')}><UiIcon name="moon" />{tr('theme.dark')}</button>
            <button className={`seg-btn ${themeMode === 'system' ? 'active' : ''}`} onClick={() => applyTheme('system')}><UiIcon name="monitor" />{tr('theme.system')}</button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-label">{tr('settings.language')}</div>
          <div className="seg">
            <button className={`seg-btn ${lang === 'vi' ? 'active' : ''}`} onClick={() => applyLang('vi')}>{tr('settings.lang_vi')}</button>
            <button className={`seg-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => applyLang('en')}>{tr('settings.lang_en')}</button>
          </div>
        </div>
      </div>

      {/* Tai khoan */}
      <div className="card settings-card settings-account-card">
        <h3 className="icon-heading"><UiIcon name="user" /> {tr('account.section')}</h3>
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
            <label className="field-label" htmlFor="profile-department">{tr('account.department')}</label>
            <input
              id="profile-department"
              className="input"
              value={profileDepartment}
              onChange={(e) => setProfileDepartment(e.target.value)}
              maxLength={100}
              placeholder={tr('account.department_placeholder')}
            />
            <label className="field-label" htmlFor="profile-employee-code">{tr('account.employee_code')}</label>
            <input
              id="profile-employee-code"
              className="input"
              value={profileEmployeeCode}
              onChange={(e) => setProfileEmployeeCode(e.target.value)}
              maxLength={100}
              placeholder={tr('account.employee_code_placeholder')}
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
                <UiIcon name="upload" />{avatarUploading ? tr('account.uploading_avatar') : tr('account.upload_avatar')}
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
                profileDepartment.trim() === (user?.department || '') &&
                profileEmployeeCode.trim() === (user?.employee_code || '') &&
                profilePicture.trim() === (user?.picture || '')
              )}
            >
              <UiIcon name="check" />{accountSaving ? tr('account.saving') : tr('account.save_profile')}
            </button>
          </div>
        </div>
      </div>

      <div className="card settings-card settings-password-card">
        <h3 className="icon-heading"><UiIcon name="lock" /> {tr('account.password')}</h3>
        <div className="account-grid no-border compact">
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
              <UiIcon name="lock" />{passwordSaving ? tr('account.saving') : tr('account.save_password')}
            </button>
          </div>
        </div>
      </div>

      {/* Tro ly AI */}
      <div className="card settings-card settings-ai-card">
        <h3 className="icon-heading"><UiIcon name="bot" /> {cleanIconLabel(tr('settings.ai_section'))}</h3>
        <div className="setting-row">
          <div>
            <div className="setting-label">{tr('settings.autocoach')}</div>
            <div className="muted setting-hint">{tr('settings.autocoach_hint')}</div>
          </div>
          <Switch on={pendingAutoCoach} onClick={toggleAutoCoach} />
        </div>
        {brainSettings ? (
          <div className="brain-settings">
            <div className="setting-row">
              <div>
                <div className="setting-label">{tr('settings.brain_daily')}</div>
                <div className="muted setting-hint">{tr('settings.brain_daily_hint')}</div>
              </div>
              <div className="brain-inline">
                <input className="input compact" type="time" value={brainSettings.daily_check_time || '08:00'}
                  onChange={(e) => setBrain('daily_check_time', e.target.value)} />
                <Switch on={brainSettings.daily_check_enabled !== false}
                  onClick={() => setBrain('daily_check_enabled', brainSettings.daily_check_enabled === false)} />
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">{tr('settings.brain_weekly')}</div>
                <div className="muted setting-hint">{tr('settings.brain_weekly_hint')}</div>
              </div>
              <div className="brain-inline">
                <select className="forecast-select" value={brainSettings.weekly_digest_weekday ?? 0}
                  onChange={(e) => setBrain('weekly_digest_weekday', Number(e.target.value))}>
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{tr(`weekday.${d}`)}</option>)}
                </select>
                <Switch on={brainSettings.weekly_digest_enabled !== false}
                  onClick={() => setBrain('weekly_digest_enabled', brainSettings.weekly_digest_enabled === false)} />
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">{tr('settings.brain_monthly')}</div>
                <div className="muted setting-hint">{tr('settings.brain_monthly_hint')}</div>
              </div>
              <div className="brain-inline">
                <input className="input compact" type="number" min="1" max="28" value={brainSettings.monthly_report_day ?? 1}
                  onChange={(e) => setBrain('monthly_report_day', Number(e.target.value))} />
                <Switch on={brainSettings.monthly_report_enabled !== false}
                  onClick={() => setBrain('monthly_report_enabled', brainSettings.monthly_report_enabled === false)} />
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">{tr('settings.brain_feedback')}</div>
                <div className="muted setting-hint">{tr('settings.brain_feedback_hint')}</div>
              </div>
              <Switch on={brainSettings.feedback_learning_enabled !== false}
                onClick={() => setBrain('feedback_learning_enabled', brainSettings.feedback_learning_enabled === false)} />
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">{tr('settings.brain_retention')}</div>
                <div className="muted setting-hint">{tr('settings.brain_retention_hint')}</div>
              </div>
              <div className="brain-inline">
                <input className="input compact" type="number" min="30" max="365" value={brainSettings.retention_days ?? 90}
                  onChange={(e) => setBrain('retention_days', Number(e.target.value))} />
                <button className="btn small ghost" onClick={cleanupBrainHistory} disabled={brainSaving}>
                  <UiIcon name="trash" />{tr('settings.brain_cleanup')}
                </button>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">{tr('settings.brain_conflict_score')}</div>
                <div className="muted setting-hint">{tr('settings.brain_conflict_score_hint', { value: Math.round(Number(brainSettings.conflict_warning_score ?? 0.7) * 100) })}</div>
              </div>
              <input className="brain-slider" type="range" min="0.4" max="0.95" step="0.05"
                value={brainSettings.conflict_warning_score ?? 0.7}
                onChange={(e) => setBrain('conflict_warning_score', Number(e.target.value))} />
            </div>
            {brainStatus?.calibrations?.length > 0 && (
              <div className="brain-calibration">
                <strong>{tr('settings.brain_calibration')}</strong>
                {brainStatus.calibrations.map((item, i) => <span key={`${item}-${i}`}>{item}</span>)}
              </div>
            )}
            {brainMsg && <div className="form-msg">{brainMsg}</div>}
            <button className="btn primary small" onClick={saveBrainSettings} disabled={brainSaving}>
              <UiIcon name="check" />{brainSaving ? tr('account.saving') : tr('settings.brain_save')}
            </button>
          </div>
        ) : (
          <div className="muted setting-hint">{tr('common.loading')}</div>
        )}
      </div>

      {/* D2: Notification settings */}
      <div className="card settings-card settings-notifications-card">
        <h3 className="icon-heading"><UiIcon name="mail" /> {tr('settings.email_notifications')}</h3>
        <p className="muted setting-hint">{tr('settings.email_notifications_hint')}</p>
        {notifSettings ? (
          <>
            <div className="notif-toggle-row">
              <div className="notif-toggle-info">
                <div className="notif-toggle-label">{tr('settings.notif_in_app')}</div>
                <div className="notif-toggle-desc">{tr('settings.notif_in_app_desc')}</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={notifSettings.in_app_enabled !== false}
                  onChange={() => toggleNotif('in_app_enabled')} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="notif-toggle-row">
              <div className="notif-toggle-info">
                <div className="notif-toggle-label">{tr('settings.notif_email_channel')}</div>
                <div className="notif-toggle-desc">{tr('settings.notif_email_channel_desc')}</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={notifSettings.email_enabled !== false}
                  onChange={() => toggleNotif('email_enabled')} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="notif-toggle-row">
              <div className="notif-toggle-info">
                <div className="notif-toggle-label">{tr('settings.notif_kpi_reminder')}</div>
                <div className="notif-toggle-desc">{tr('settings.notif_kpi_reminder_desc')}</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={notifSettings.kpi_reminder_enabled}
                  onChange={() => toggleNotif('kpi_reminder_enabled')} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="notif-toggle-row">
              <div className="notif-toggle-info">
                <div className="notif-toggle-label">{tr('settings.notif_weekly_summary')}</div>
                <div className="notif-toggle-desc">{tr('settings.notif_weekly_summary_desc')}</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={notifSettings.weekly_summary_enabled}
                  onChange={() => toggleNotif('weekly_summary_enabled')} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="notif-toggle-row">
              <div className="notif-toggle-info">
                <div className="notif-toggle-label">{tr('settings.notif_sync_error')}</div>
                <div className="notif-toggle-desc">{tr('settings.notif_sync_error_desc')}</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={notifSettings.sync_error_enabled}
                  onChange={() => toggleNotif('sync_error_enabled')} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-row" style={{ marginTop: 12 }}>
              <div className="setting-label">{tr('settings.notif_recipient')}</div>
              <input
                placeholder={tr('settings.notif_recipient_ph')}
                value={notifEmail}
                onChange={e => setNotifEmail(e.target.value)}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13 }}
              />
            </div>
            {notifMsg && <div style={{ fontSize: 13, color: notifOk ? '#16a34a' : '#dc2626', marginTop: 8 }}>{notifMsg}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary small" onClick={saveNotifSettings} disabled={notifSaving}>
                <UiIcon name="check" />{notifSaving ? tr('account.saving') : tr('settings.notif_save')}
              </button>
              <button className="btn small" onClick={sendTestEmail}><UiIcon name="mail" />{tr('settings.notif_test_email')}</button>
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>{tr('common.loading')}</div>
        )}
      </div>

      <div className="card settings-card settings-reset-card">
        <h3 className="icon-heading"><UiIcon name="refresh" /> {tr('settings.reset_section')}</h3>
        <div className="setting-row">
          <div className="muted setting-hint">{tr('settings.reset_hint')}</div>
          <button className="btn danger" onClick={() => setShowResetConfirm(true)}><UiIcon name="refresh" />{tr('settings.reset_btn')}</button>
        </div>
      </div>
        </div>
      </div>

      {/* Nut Luu tong */}
      <div className="settings-footer">
        <button className={`btn primary${dirty ? '' : ' muted'}`} onClick={saveAll} disabled={!dirty}>
          <UiIcon name="check" />{tr('settings.save_all')}
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
