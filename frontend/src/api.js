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
  return res.json()
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

  // KPI
  listKpis: () => request('/kpis'),
  createKpi: (data) => request('/kpis', { method: 'POST', body: JSON.stringify(data) }),
  updateKpi: (id, data) => request(`/kpis/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKpi: (id, reason) => request(`/kpis/${id}?reason=${encodeURIComponent(reason || '')}`, { method: 'DELETE' }),
  decomposeKpi: (id) => request(`/kpis/${id}/decompose`, { method: 'POST' }, 120000),
  balanceWeights: (objectiveId) =>
      request('/kpis/balance', { method: 'POST', body: JSON.stringify({ objective_id: objectiveId }) }),
  confirmKpiProposal: (payload) =>
      request('/kpis/confirm-proposal', { method: 'POST', body: JSON.stringify(payload) }),
  analyzeConflicts: () => request('/kpis/conflicts/analyze', { method: 'POST' }, 120000),
  kpiChangelog: (id) => request(`/kpis/${id}/changelog`),
  allChangelog: () => request('/kpis/changelog/all'),
  archivedKpis: () => request('/kpis/archived'),
  restoreKpi: (id) => request(`/kpis/${id}/restore`, { method: 'POST' }),
  importKpis: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return request('/kpis/import', { method: 'POST', body: fd })
  },

  // Objectives
  listObjectives: () => request('/objectives'),
  createObjective: (data) => request('/objectives', { method: 'POST', body: JSON.stringify(data) }),
  updateObjective: (id, data) => request(`/objectives/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteObjective: (id) => request(`/objectives/${id}`, { method: 'DELETE' }),

  // Chat
  sendChat: (message, sessionId = null, lang = 'vi', timeoutMs = 90000) =>
      request('/chat', { method: 'POST', body: JSON.stringify({ message, session_id: sessionId, lang }) }, timeoutMs),
  chatHistory: (sessionId) => request(`/chat/history${sessionId ? `?session_id=${sessionId}` : ''}`),
  chatSessions: () => request('/chat/sessions'),
  newChatSession: () => request('/chat/sessions', { method: 'POST' }),
  deleteChatSession: (id) => request(`/chat/sessions/${id}`, { method: 'DELETE' }),

  // Work items
  listWorkItems: (params = '') => request('/work-items' + params),
  confirmItems: (items) => request('/work-items/confirm', { method: 'POST', body: JSON.stringify({ items }) }),
  updateWorkItemStatus: (id, status, valueDelta = 0) =>
      request(`/work-items/${id}/status?status=${status}&value_delta=${valueDelta}`, { method: 'PUT' }),

  // Sources
  sourcesStatus: () => request('/sources/status'),
  syncSources: (data) => request('/sources/sync', { method: 'POST', body: JSON.stringify(data) }),
  uploadWorklog: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return request('/sources/upload', { method: 'POST', body: fd })
  },

  // Reports
  dashboard: () => request('/reports/dashboard'),
  weeklyReport: () => request('/reports/weekly'),
  generateReport: (periodType, periodLabel = null) =>
      request('/reports/generate', {
        method: 'POST',
        body: JSON.stringify({ period_type: periodType, period_label: periodLabel }),
      }, 120000),
  savedReports: () => request('/reports/saved'),
  regenerateReport: (id) => request(`/reports/saved/${id}/regenerate`, { method: 'POST' }, 120000),
  deleteReport: (id) => request(`/reports/saved/${id}`, { method: 'DELETE' }),
  exportUrl: BASE + '/reports/export',
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
}
