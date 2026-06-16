const DEFAULT_SUPPORT_CONFIG = {
  subject: '[KPI Companion] Yêu cầu hỗ trợ kỹ thuật',
  slackChannel: '#kpi-support',
  slackEnabled: false,
  admins: [
    {
      name: 'Hồ Tính Tính',
      domain: 'TinhHT',
      phone: '0901 234 567',
      email: 'tinhht@vng.com.vn',
      hours: 'Thứ 2 - Thứ 6, 8:30 - 17:30',
    },
    {
      name: 'Vũ Nguyễn Huy Chương',
      domain: 'ChuongVNH',
      phone: '0901 234 567',
      email: 'chuongvnh@vng.com.vn',
      hours: 'Thứ 2 - Thứ 6, 8:30 - 17:30',
    },
    {
      name: 'Nguyễn Hoài Nam',
      domain: 'NamNH15',
      phone: '0901 234 567',
      email: 'namnh15@vng.com.vn',
      hours: 'Thứ 2 - Thứ 6, 8:30 - 17:30',
    },
  ],
}

function normalizeAdmin(admin) {
  if (!admin || typeof admin !== 'object') return null
  const normalized = {
    name: String(admin.name || '').trim(),
    domain: String(admin.domain || '').trim(),
    phone: String(admin.phone || '').trim(),
    email: String(admin.email || '').trim(),
    hours: String(admin.hours || '').trim(),
  }
  return normalized.name && normalized.email ? normalized : null
}

function normalizeConfig(raw) {
  const admins = Array.isArray(raw?.admins)
    ? raw.admins.map(normalizeAdmin).filter(Boolean)
    : []
  const safeAdmins = admins.length ? admins : DEFAULT_SUPPORT_CONFIG.admins

  return {
    subject: String(raw?.subject || DEFAULT_SUPPORT_CONFIG.subject).trim(),
    supportEmail: String(raw?.supportEmail || safeAdmins.map(a => a.email).join(',')).trim(),
    slackChannel: String(raw?.slackChannel || DEFAULT_SUPPORT_CONFIG.slackChannel).trim(),
    slackEnabled: Boolean(raw?.slackEnabled),
    admins: safeAdmins,
  }
}

export async function loadSupportConfig() {
  try {
    const res = await fetch('/support-config.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    return { config: normalizeConfig(json), usedFallback: false }
  } catch {
    return { config: normalizeConfig(DEFAULT_SUPPORT_CONFIG), usedFallback: true }
  }
}
