import html2canvas from 'html2canvas'

export async function captureScreen(element) {
  if (!element) throw new Error('Không tìm thấy vùng màn hình cần phân tích.')
  const theme = document.documentElement.dataset.theme || 'light'
  const canvas = await html2canvas(element, {
    useCORS: true,
    allowTaint: true,
    scale: Math.min(window.devicePixelRatio || 1.5, 2),
    backgroundColor: theme === 'dark' ? '#0e1326' : '#f4f5fc',
    logging: false,
    ignoreElements: (node) => node?.dataset?.helpIgnore === 'true',
  })
  return canvas.toDataURL('image/png').split(',')[1]
}
