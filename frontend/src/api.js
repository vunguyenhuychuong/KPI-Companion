const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let detail = `Lỗi ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  return res.json()
}

export const api = {
  // KPI
  listKpis: () => request('/kpis'),
  createKpi: (data) => request('/kpis', { method: 'POST', body: JSON.stringify(data) }),
  updateKpi: (id, data) => request(`/kpis/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKpi: (id, reason) => request(`/kpis/${id}?reason=${encodeURIComponent(reason || '')}`, { method: 'DELETE' }),
  decomposeKpi: (id) => request(`/kpis/${id}/decompose`, { method: 'POST' }),
  kpiChangelog: (id) => request(`/kpis/${id}/changelog`),
  importKpis: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return request('/kpis/import', { method: 'POST', body: fd })
  },

  // Chat
  sendChat: (message) => request('/chat', { method: 'POST', body: JSON.stringify({ message }) }),
  chatHistory: () => request('/chat/history'),

  // Work items
  listWorkItems: (params = '') => request('/work-items' + params),
  confirmItems: (items) => request('/work-items/confirm', { method: 'POST', body: JSON.stringify({ items }) }),

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
