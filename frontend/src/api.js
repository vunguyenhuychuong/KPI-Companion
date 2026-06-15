const BASE = '/api'

function getToken() {
  return localStorage.getItem('kpi_token')
}

async function request(path, options = {}, timeoutMs = 0) {
  const controller = timeoutMs > 0 ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  const token = getToken()
  const headers = {}
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  let res
  try {
    res = await fetch(BASE + path, {
      headers,
      signal: controller?.signal,
      ...options,
    })
  } catch (err) {
    // Request bị hủy do quá thời gian chờ (AbortController) — tách riêng với lỗi mạng.
    if (err.name === 'AbortError') {
      throw new Error('Yêu cầu mất quá nhiều thời gian và đã bị hủy. Vui lòng thử lại.')
    }
    // TypeError "Failed to fetch": không tới được backend (chưa chạy / sai cổng).
    throw new Error('Không kết nối được máy chủ — backend (cổng 8000) có thể chưa chạy. Hãy khởi động backend rồi thử lại.')
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (res.status === 401) {
    localStorage.removeItem('kpi_token')
    localStorage.removeItem('kpi_user')
    window.location.reload()
    throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại')
  }
  if (!res.ok) {
    let detail = `Lỗi ${res.status}`
    try {
      const data = await res.json()
      if (Array.isArray(data.detail)) {
        // Pydantic 422 validation error: [{loc, msg, type}, ...]
        detail = data.detail
          .map(e => e.msg.replace(/^Value error,\s*/i, ''))
          .join(' | ')
      } else {
        detail = data.detail || detail
      }
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const api = {
  // Auth
  authConfig: () => request('/auth/config'),
  login: (email, password) =>
      request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email, password, name) =>
      request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  googleLogin: (credential) =>
      request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  forgotPassword: (email) =>
      request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, newPassword) =>
      request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, new_password: newPassword }) }),
  // D1: Onboarding
  getMe: () => request('/auth/me'),
  updateMe: (profile) =>
      request('/auth/me', { method: 'PUT', body: JSON.stringify(profile) }),
  uploadAvatar: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return request('/auth/me/avatar', { method: 'POST', body: fd })
  },
  updatePassword: (currentPassword, newPassword) =>
      request('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }),
  completeOnboarding: (role = '') =>
      request('/auth/onboarding/complete', { method: 'POST', body: JSON.stringify({ role }) }),
  skipOnboarding: () =>
      request('/auth/onboarding/skip', { method: 'POST', body: '{}' }),

  // KPI
  listKpis: (cycleId) => request('/kpis' + (cycleId ? `?cycle_id=${cycleId}` : '')),
  createKpi: (data) => request('/kpis', { method: 'POST', body: JSON.stringify(data) }),
  updateKpi: (id, data) => request(`/kpis/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKpi: (id, reason) => request(`/kpis/${id}?reason=${encodeURIComponent(reason || '')}`, { method: 'DELETE' }),
  decomposeKpi: (id) => request(`/kpis/${id}/decompose`, { method: 'POST' }, 120000),
  balanceWeights: (objectiveId) =>
      request('/kpis/balance', { method: 'POST', body: JSON.stringify({ objective_id: objectiveId }) }),
  confirmKpiProposal: (payload) =>
      request('/kpis/confirm-proposal', { method: 'POST', body: JSON.stringify(payload) }),
  analyzeConflicts: () => request('/kpis/conflicts/analyze', { method: 'POST' }, 120000),
  kpiForecast: (id) => request(`/kpis/${id}/forecast`),
  coachKpi: (id, lang = 'vi') => request(`/kpis/${id}/coach?lang=${lang}`, { method: 'POST' }, 120000),
  smartValidateKpi: (id) => request(`/kpis/${id}/validate-smart`, { method: 'POST' }, 60000),
  kpiChangelog: (id) => request(`/kpis/${id}/changelog`),
  allChangelog: (params = '') => request('/kpis/changelog/all' + params),
  archivedKpis: () => request('/kpis/archived'),
  restoreKpi: (id) => request(`/kpis/${id}/restore`, { method: 'POST' }),
  deleteKpiPermanent: (id) => request(`/kpis/${id}/permanent`, { method: 'DELETE' }),
  previewImport: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    let res
    try {
      res = await fetch(`${BASE}/kpis/import/preview`, { method: 'POST', headers, body: fd })
    } catch {
      throw new Error('Không kết nối được máy chủ — backend (cổng 8000) có thể chưa chạy.')
    }
    if (res.status === 401) {
      localStorage.removeItem('kpi_token'); localStorage.removeItem('kpi_user')
      window.location.reload()
      throw new Error('Phiên đăng nhập hết hạn')
    }
    const data = await res.json()
    if (!res.ok) {
      const err = new Error(
        (typeof data.detail === 'string' ? data.detail : data.detail?.message) || `Lỗi ${res.status}`
      )
      err._type = data.detail?.type
      throw err
    }
    return data
  },

  importKpis: async (file, mode = 'auto') => {
    const fd = new FormData()
    fd.append('file', file)
    const token = getToken()
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    let res
    try {
      res = await fetch(`${BASE}/kpis/import?mode=${mode}`, { method: 'POST', headers, body: fd })
    } catch {
      throw new Error('Không kết nối được máy chủ — backend (cổng 8000) có thể chưa chạy.')
    }
    if (res.status === 401) {
      localStorage.removeItem('kpi_token'); localStorage.removeItem('kpi_user')
      window.location.reload()
      throw new Error('Phiên đăng nhập hết hạn')
    }
    const data = await res.json()
    // 409 weight_conflict: tra ve object dac biet de frontend hien dialog
    if (res.status === 409 && data.detail?.type === 'weight_conflict') {
      return { _conflict: true, ...data.detail }
    }
    if (!res.ok) {
      const d = data.detail
      throw new Error(
        Array.isArray(d) ? d.map(e => e.msg.replace(/^Value error,\s*/i, '')).join(' | ')
          : (typeof d === 'string' ? d : JSON.stringify(d)) || `Lỗi ${res.status}`
      )
    }
    return data
  },

  validateKpiWeights: (objectiveId, newWeight, excludeId) => {
    const p = new URLSearchParams({ new_weight: newWeight ?? 0 })
    if (objectiveId != null) p.set('objective_id', objectiveId)
    if (excludeId != null) p.set('exclude_id', excludeId)
    return request(`/kpis/validate-weights?${p}`)
  },
  validateObjectiveWeights: (cycleId, newWeight, excludeId) => {
    const p = new URLSearchParams({ new_weight: newWeight ?? 0 })
    if (cycleId != null) p.set('cycle_id', cycleId)
    if (excludeId != null) p.set('exclude_id', excludeId)
    return request(`/objectives/validate-weights?${p}`, { method: 'POST' })
  },

  autoMapKpis: (kpiIds) => request('/kpis/auto-map', {
    method: 'POST', body: JSON.stringify({ kpi_ids: kpiIds }),
  }, 120000),

  // Cycles (chu ky danh gia)
  listCycles: () => request('/cycles'),
  createCycle: (data) => request('/cycles', { method: 'POST', body: JSON.stringify(data) }),
  updateCycle: (id, data) => request(`/cycles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCycle: (id) => request(`/cycles/${id}`, { method: 'DELETE' }),
  lockCycle: (id, reason = '') => request(`/cycles/${id}/lock`, { method: 'POST', body: JSON.stringify({ reason }) }),
  unlockCycle: (id, reason = '') => request(`/cycles/${id}/unlock`, { method: 'POST', body: JSON.stringify({ reason }) }),
  cloneCycle: (id, data) => request(`/cycles/${id}/clone`, { method: 'POST', body: JSON.stringify(data) }),
  compareCycles: (ids) => request(`/cycles/compare?cycle_ids=${ids.join(',')}`),
  // D5: Share links
  listShareLinks: (cycleId) => request(`/cycles/${cycleId}/share-links`),
  createShareLink: (cycleId, expiresInDays = 7) =>
      request(`/cycles/${cycleId}/share-links`, { method: 'POST', body: JSON.stringify({ expires_in_days: expiresInDays }) }),
  revokeShareLink: (token) => request(`/share-links/${token}`, { method: 'DELETE' }),
  getSharedReport: (token) => request(`/shared/${token}`),
  // D2: Notification settings
  getNotificationSettings: () => request('/notification-settings'),
  updateNotificationSettings: (data) =>
      request('/notification-settings', { method: 'PUT', body: JSON.stringify(data) }),
  sendTestEmail: () => request('/notification-settings/send-test', { method: 'POST', body: '{}' }),
  sendKpiReminder: () => request('/notification-settings/send-reminder', { method: 'POST', body: '{}' }),
  sendWeeklySummary: () => request('/notification-settings/send-weekly-summary', { method: 'POST', body: '{}' }),

  // Objectives
  listObjectives: (cycleId) => request('/objectives' + (cycleId ? `?cycle_id=${cycleId}` : '')),
  createObjective: (data) => request('/objectives', { method: 'POST', body: JSON.stringify(data) }),
  updateObjective: (id, data) => request(`/objectives/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteObjective: (id) => request(`/objectives/${id}`, { method: 'DELETE' }),

  // Chat
  sendChat: (message, sessionId = null, lang = 'vi', timeoutMs = 90000) =>
      request('/chat', { method: 'POST', body: JSON.stringify({ message, session_id: sessionId, lang }) }, timeoutMs),
  chatHistory: (sessionId) => request(`/chat/history${sessionId ? `?session_id=${sessionId}` : ''}`),
  chatSessions: () => request('/chat/sessions'),
  setProposalStatus: (messageId, status) =>
      request(`/chat/messages/${messageId}/proposal-status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  listMemories: () => request('/chat/memories'),
  deleteMemory: (id) => request(`/chat/memories/${id}`, { method: 'DELETE' }),
  newChatSession: () => request('/chat/sessions', { method: 'POST' }),
  deleteChatSession: (id) => request(`/chat/sessions/${id}`, { method: 'DELETE' }),

  // Work items
  listWorkItems: (params = '') => request('/work-items' + params),
  deleteWorkItem: (id) => request(`/work-items/${id}`, { method: 'DELETE' }),
  confirmItems: (items) => request('/work-items/confirm', { method: 'POST', body: JSON.stringify({ items }) }),
  confirmDeleteKpi: (payload) => request('/kpis/confirm-delete', { method: 'POST', body: JSON.stringify(payload) }),
  updateWorkItemStatus: (id, status, valueDelta = 0) =>
      request(`/work-items/${id}/status?status=${status}&value_delta=${valueDelta}`, { method: 'PUT' }),

  // Notifications (proactive alerts)
  notifications: () => request('/notifications'),
  burnoutCheck: () => request('/burnout'),

  // Settings (app-level connection config)
  getConnectionSettings: () => request('/settings/connections'),
  setConnectionSettings: (googleMockMode) =>
      request('/settings/connections', { method: 'PUT', body: JSON.stringify({ google_mock_mode: googleMockMode }) }),

  // Integrations (OAuth ket noi nguon du lieu theo tung nguoi dung)
  listIntegrations: () => request('/oauth/providers'),
  startOAuth: (provider) => request(`/oauth/${provider}/start`),
  disconnectIntegration: (provider) => request(`/oauth/${provider}`, { method: 'DELETE' }),

  // Sources
  sourcesStatus: () => request('/sources/status'),
  syncSources: (data) => request('/sources/sync', { method: 'POST', body: JSON.stringify(data) }),
  uploadWorklog: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return request('/sources/upload', { method: 'POST', body: fd })
  },

  // Reports
  dashboard: (cycleId) => request('/reports/dashboard' + (cycleId ? `?cycle_id=${cycleId}` : '')),
  weeklyReport: () => request('/reports/weekly'),
  generateReport: (periodType, periodLabel = null) =>
      request('/reports/generate', {
        method: 'POST',
        body: JSON.stringify({ period_type: periodType, period_label: periodLabel }),
      }, 120000),
  savedReports: () => request('/reports/saved'),
  sendToManager: (channel, recipient, subject, content) =>
      request('/reports/send-to-manager', { method: 'POST', body: JSON.stringify({ channel, recipient, subject, content }) }),
  quickSendEmail: (recipient, subject, content) =>
      request('/reports/quick-send-email', {
        method: 'POST',
        body: JSON.stringify({ recipient, subject, content })
      }),
  regenerateReport: (id) => request(`/reports/saved/${id}/regenerate`, { method: 'POST' }, 120000),
  deleteReport: (id) => request(`/reports/saved/${id}`, { method: 'DELETE' }),
  exportUrl: BASE + '/reports/export',

  // Tai file kem token Bearer (the <a href> khong gui duoc header -> bi 401)
  downloadFile: async (path, fallbackName) => {
    const token = getToken()
    const res = await fetch(BASE + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (res.status === 401) throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại')
    if (!res.ok) {
      let detail = `Lỗi ${res.status}`
      try { detail = (await res.json()).detail || detail } catch { /* ignore */ }
      throw new Error(detail)
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename="?([^";]+)/)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = m ? decodeURIComponent(m[1]) : fallbackName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(a.href)
  },
  generateSelfReview: () => request('/reports/self-review', { method: 'POST' }, 120000),
  exportSavedReport: (id, format) => api.downloadFile(
    `/reports/saved/${id}/export?format=${format}`,
    `tu-danh-gia.${format}`,
  ),
  exportEvaluation: () => api.downloadFile('/reports/export', 'bao-cao-kpi.xlsx'),
  exportAppraisal: () => api.downloadFile('/reports/export-appraisal', 'performance-appraisal.xlsx'),
  exportData: (formats, sections) => api.downloadFile(
    `/reports/export-data?formats=${encodeURIComponent(formats.join(','))}&sections=${encodeURIComponent(sections.join(','))}`,
    'kpi-export',
  ),
}

export const STATUS_LABELS = {
  da_lam: 'Đã làm',
  dang_lam: 'Đang làm',
  se_lam: 'Sẽ làm',
  phat_sinh: 'Phát sinh',
  loai_bo: 'Loại bỏ',
}

export const STATUS_COLORS = {
  da_lam: '#16a34a',
  dang_lam: '#2563eb',
  se_lam: '#9333ea',
  phat_sinh: '#ea580c',
  loai_bo: '#6b7280',
}

export const SOURCE_LABELS = {
  chat: '💬 Chat',
  csv: '📄 File',
  gmail: '✉️ Gmail',
  calendar: '📅 Calendar',
  sheets: '📊 Sheets',
  notion: '📝 Notion',
  slack: '💬 Slack',
  outlook: '📧 Outlook',
}
