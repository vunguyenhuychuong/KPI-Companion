const BASE = '/api/help'

function tokenHeaders() {
  const token = localStorage.getItem('kpi_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function normalizeGuide(data) {
  return {
    screen: data?.screen || '',
    summary: data?.summary || '',
    issue: data?.issue || '',
    steps: Array.isArray(data?.steps) ? data.steps.slice(0, 4) : [],
    tip: data?.tip || '',
    source: data?.source || 'vision',
  }
}

export async function getVisionConfig() {
  const res = await fetch(`${BASE}/vision-config`, { headers: tokenHeaders() })
  if (!res.ok) return { configured: false }
  return res.json()
}

export async function callVisionAPI({ base64Image, screenHint, lang }) {
  const res = await fetch(`${BASE}/vision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...tokenHeaders(),
    },
    body: JSON.stringify({
      image: base64Image,
      screen_hint: screenHint || '',
      lang: lang || 'vi',
    }),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(text || 'Vision AI trả về dữ liệu không hợp lệ.')
  }
  if (!res.ok) {
    throw new Error(data?.detail || `API ${res.status}`)
  }
  return normalizeGuide(data)
}
