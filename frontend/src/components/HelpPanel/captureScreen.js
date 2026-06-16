import html2canvas from 'html2canvas'

const COLOR_PROPS = [
  'color',
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'caretColor',
]

const UNSUPPORTED_COLOR_RE = /\b(?:color|color-mix|lab|lch|oklab|oklch)\(/i

function clamp255(value) {
  return Math.max(0, Math.min(255, Math.round(value * 255)))
}

function parseCssColorFunction(value) {
  const match = String(value).match(/^color\(\s*[\w-]+\s+(.+?)\s*\)$/i)
  if (!match) return value

  const [channelsPart, alphaPart] = match[1].split('/').map(part => part.trim())
  const channels = channelsPart.split(/\s+/).slice(0, 3).map(part => {
    if (part.endsWith('%')) return parseFloat(part) / 100
    return parseFloat(part)
  })
  if (channels.length < 3 || channels.some(Number.isNaN)) return 'rgba(0,0,0,0)'

  let alpha = alphaPart ? parseFloat(alphaPart) : 1
  if (alphaPart?.endsWith('%')) alpha = parseFloat(alphaPart) / 100
  if (Number.isNaN(alpha)) alpha = 1

  return `rgba(${clamp255(channels[0])}, ${clamp255(channels[1])}, ${clamp255(channels[2])}, ${Math.max(0, Math.min(1, alpha))})`
}

function sanitizeColorValue(value, fallback = 'rgba(0,0,0,0)') {
  if (!value) return value
  const raw = String(value)
  if (raw.startsWith('color(')) return parseCssColorFunction(raw)
  if (UNSUPPORTED_COLOR_RE.test(raw)) return fallback
  return raw
}

function sanitizeImageValue(value) {
  if (!value || value === 'none') return value
  return UNSUPPORTED_COLOR_RE.test(String(value)) ? 'none' : value
}

function sanitizeClone(clonedElement) {
  const doc = clonedElement.ownerDocument
  const nodes = [clonedElement, ...clonedElement.querySelectorAll('*')]
  nodes.forEach(node => {
    const computed = doc.defaultView.getComputedStyle(node)
    COLOR_PROPS.forEach(prop => {
      const safe = sanitizeColorValue(computed[prop])
      if (safe !== computed[prop]) node.style[prop] = safe
    })

    node.style.backgroundImage = sanitizeImageValue(computed.backgroundImage)
    node.style.borderImageSource = sanitizeImageValue(computed.borderImageSource)
    node.style.listStyleImage = sanitizeImageValue(computed.listStyleImage)

    if (UNSUPPORTED_COLOR_RE.test(computed.boxShadow || '')) {
      node.style.boxShadow = 'none'
    }
    if (UNSUPPORTED_COLOR_RE.test(computed.textShadow || '')) {
      node.style.textShadow = 'none'
    }
    if (UNSUPPORTED_COLOR_RE.test(computed.filter || '')) {
      node.style.filter = 'none'
    }
  })
}

export async function captureScreen(element) {
  if (!element) throw new Error('help.capture_missing')
  const theme = document.documentElement.dataset.theme || 'light'
  const canvas = await html2canvas(element, {
    useCORS: true,
    allowTaint: true,
    scale: Math.min(window.devicePixelRatio || 1.5, 2),
    backgroundColor: theme === 'dark' ? '#0a1021' : '#f3f7fb',
    logging: false,
    ignoreElements: (node) => node?.dataset?.helpIgnore === 'true',
    onclone: (doc, clonedElement) => sanitizeClone(clonedElement),
  })
  return canvas.toDataURL('image/png').split(',')[1]
}
