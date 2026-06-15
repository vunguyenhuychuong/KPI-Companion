// Tuy chinh nguoi dung luu o localStorage (client-side, per-trinh-duyet).
const KEYS = {
  autoCoach: 'kpi_autocoach',
  exportFormats: 'kpi_export_formats',
  exportSections: 'kpi_export_sections',
  mgrChannel: 'kpi_mgr_channel',
  mgrRecipient: 'kpi_mgr_recipient',
}

const DEFAULTS = {
  autoCoach: false,
  exportFormats: ['xlsx'],
  exportSections: ['kpis', 'work_items', 'changelog', 'reports'],
  mgrChannel: 'email',
  mgrRecipient: '',
}

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return Array.isArray(v) ? v : fallback
  } catch { return fallback }
}

export const prefs = {
  getAutoCoach: () => localStorage.getItem(KEYS.autoCoach) === '1',
  setAutoCoach: (on) => localStorage.setItem(KEYS.autoCoach, on ? '1' : '0'),

  getExportFormats: () => readJSON(KEYS.exportFormats, DEFAULTS.exportFormats),
  setExportFormats: (arr) => localStorage.setItem(KEYS.exportFormats, JSON.stringify(arr)),

  getExportSections: () => readJSON(KEYS.exportSections, DEFAULTS.exportSections),
  setExportSections: (arr) => localStorage.setItem(KEYS.exportSections, JSON.stringify(arr)),

  getMgrChannel: () => localStorage.getItem(KEYS.mgrChannel) || DEFAULTS.mgrChannel,
  setMgrChannel: (v) => localStorage.setItem(KEYS.mgrChannel, v),

  getMgrRecipient: () => localStorage.getItem(KEYS.mgrRecipient) || DEFAULTS.mgrRecipient,
  setMgrRecipient: (v) => localStorage.setItem(KEYS.mgrRecipient, v),

  reset: () => Object.values(KEYS).forEach((k) => localStorage.removeItem(k)),

  // Thông báo: trạng thái đã đọc / đã ẩn (chống lặp, lưu client)
  getNotifRead: () => readJSON('kpi_notif_read', []),
  addNotifRead: (ids) => {
    const cur = new Set(readJSON('kpi_notif_read', []))
    ids.forEach((id) => cur.add(id))
    localStorage.setItem('kpi_notif_read', JSON.stringify([...cur]))
  },
  getNotifDismissed: () => readJSON('kpi_notif_dismissed', []),
  addNotifDismissed: (id) => {
    const cur = new Set(readJSON('kpi_notif_dismissed', []))
    cur.add(id)
    localStorage.setItem('kpi_notif_dismissed', JSON.stringify([...cur]))
  },
}

export const EXPORT_FORMATS = [['csv', 'CSV'], ['md', 'Markdown'], ['xlsx', 'Excel'], ['json', 'JSON'], ['pdf', 'PDF'], ['docx', 'Word']]
export const EXPORT_SECTIONS = [['kpis', 'export.sec_kpis'], ['work_items', 'export.sec_work_items'], ['changelog', 'export.sec_changelog'], ['reports', 'export.sec_reports']]
