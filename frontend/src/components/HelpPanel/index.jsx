import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLang } from '../../LangContext'
import { captureScreen } from './captureScreen'
import { callVisionAPI, getVisionConfig } from './callVisionAPI'

const COOLDOWN_MS = 5000

const fallbackByPath = {
  '/dashboard': {
    screen: 'Dashboard',
    steps: ['Xem tổng tiến độ và các cảnh báo ở đầu trang.', 'Mở phần việc cần làm để cập nhật các đầu việc đến hạn.', 'Chọn một KPI rủi ro để xem dự báo và gợi ý coach.'],
  },
  '/kpis': {
    screen: 'KPI của tôi',
    steps: ['Kiểm tra tổng trọng số Objective và KPI trong từng nhóm.', 'Dùng nút thêm KPI trong đúng Objective để giữ cấu trúc rõ ràng.', 'Mở lịch sử thay đổi trước khi chỉnh các KPI quan trọng.'],
  },
  '/chat': {
    screen: 'Trợ lý AI',
    steps: ['Nhập cập nhật công việc bằng ngôn ngữ tự nhiên.', 'Rà soát thẻ đề xuất trước khi xác nhận lưu vào hệ thống.', 'Dùng câu hỏi như “KPI nào đang chậm?” để nhận phân tích nhanh.'],
  },
  '/reports': {
    screen: 'Báo cáo',
    steps: ['Chọn kỳ báo cáo cần tạo hoặc mở báo cáo đã lưu.', 'Xem trước nội dung trước khi gửi cho quản lý.', 'Xuất PDF hoặc Excel khi cần nộp bản chính thức.'],
  },
  '/journal': {
    screen: 'Nhật ký',
    steps: ['Dùng bộ lọc để tìm bằng chứng công việc hoặc lịch sử thay đổi.', 'Kiểm tra cột KPI để biết đầu việc đã đóng góp vào chỉ tiêu nào.', 'Khôi phục KPI đã archive nếu cần dùng lại.'],
  },
  '/sources': {
    screen: 'Nguồn dữ liệu',
    steps: ['Chọn nguồn dữ liệu muốn quét.', 'Giữ mock mode khi demo hoặc chưa có credentials thật.', 'Sau khi quét, xác nhận các thẻ đề xuất trước khi ghi tiến độ.'],
  },
  '/settings': {
    screen: 'Cài đặt',
    steps: ['Cập nhật hồ sơ và giao diện theo cách bạn làm việc.', 'Bật hoặc tắt AI Coach tự động tùy mức cần hỗ trợ.', 'Kiểm tra cấu hình kết nối trước khi dùng dữ liệu thật.'],
  },
}

function fallbackGuide(path, tr) {
  const base = fallbackByPath[path] || fallbackByPath['/dashboard']
  return {
    screen: base.screen,
    summary: tr('help.fallback_summary'),
    issue: '',
    steps: base.steps,
    tip: tr('help.fallback_tip'),
    source: 'fallback',
  }
}

const btnStyle = {
  position: 'fixed',
  right: 20,
  bottom: 22,
  zIndex: 900,
  width: 46,
  height: 46,
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,.2)',
  background: 'linear-gradient(135deg, #2563eb, #14b8a6)',
  color: '#fff',
  boxShadow: '0 14px 34px rgba(37,99,235,.28)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  fontSize: 20,
  fontWeight: 800,
  transition: 'transform .15s ease, box-shadow .15s ease',
}

export default function HelpPanel({ targetRef, position = 'right', screenName }) {
  const { tr, lang } = useLang()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [guide, setGuide] = useState(null)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [lastRun, setLastRun] = useState(0)
  const [configured, setConfigured] = useState(null)

  useEffect(() => {
    getVisionConfig().then(cfg => setConfigured(Boolean(cfg.configured))).catch(() => setConfigured(false))
  }, [])

  const panelStyle = useMemo(() => {
    const side = position === 'left' ? { left: 16 } : { right: 16 }
    return {
      position: 'fixed',
      top: 72,
      ...side,
      zIndex: 899,
      width: 'min(380px, calc(100vw - 32px))',
      maxHeight: 'calc(100vh - 100px)',
      overflow: 'auto',
      background: 'var(--card)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      boxShadow: '0 24px 70px rgba(15,23,42,.28)',
    }
  }, [position])

  const handleOpen = useCallback(async () => {
    const now = Date.now()
    if (loading || (now - lastRun < COOLDOWN_MS && guide)) {
      setIsOpen(true)
      return
    }
    setIsOpen(true)
    setLoading(true)
    setError(null)
    setGuide(null)
    setShowPreview(false)
    setLastRun(now)
    try {
      const target = targetRef?.current ?? document.body
      const base64Image = await captureScreen(target)
      setPreview(`data:image/png;base64,${base64Image}`)
      const visionReady = configured ?? Boolean((await getVisionConfig().catch(() => ({ configured: false }))).configured)
      setConfigured(visionReady)
      if (!visionReady) {
        setGuide(fallbackGuide(location.pathname, tr))
        return
      }
      const result = await callVisionAPI({
        base64Image,
        screenHint: screenName || location.pathname,
        lang,
      })
      setGuide(result)
    } catch (err) {
      setError(err.message || tr('help.error_generic'))
      setGuide(fallbackGuide(location.pathname, tr))
    } finally {
      setLoading(false)
    }
  }, [configured, guide, lang, lastRun, loading, location.pathname, screenName, targetRef, tr])

  function closePanel() {
    setIsOpen(false)
    setGuide(null)
    setError(null)
    setShowPreview(false)
  }

  return (
    <div data-help-ignore="true">
      <button
        type="button"
        className="help-panel-trigger"
        style={btnStyle}
        onClick={isOpen ? closePanel : handleOpen}
        title={tr('help.open')}
        aria-label={tr('help.open')}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px) scale(1.05)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
      >
        {isOpen ? '×' : '?'}
      </button>

      {isOpen && (
        <section className="help-panel-drawer" style={panelStyle} aria-live="polite">
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--grad-soft)', color: 'var(--primary)', fontWeight: 900 }}>?</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: 'block', fontSize: 14 }}>{tr('help.title')}</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{tr('help.subtitle')}</span>
            </div>
            <button type="button" className="msg-tool" onClick={closePanel} aria-label={tr('common.cancel')}>×</button>
          </div>

          <div style={{ padding: 16 }}>
            {loading && (
              <div style={{ padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 13 }}>
                {tr('help.loading')}
              </div>
            )}

            {error && (
              <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'rgba(220,38,38,.10)', border: '1px solid rgba(220,38,38,.30)', color: '#dc2626', fontSize: 13 }}>
                {error}
              </div>
            )}

            {guide && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <span style={{ display: 'inline-flex', padding: '3px 9px', borderRadius: 999, background: 'var(--grad-soft)', color: 'var(--primary)', fontSize: 12, fontWeight: 800 }}>
                    {guide.screen || tr('help.current_screen')}
                  </span>
                  <p style={{ marginTop: 8, color: 'var(--text)', fontSize: 14, lineHeight: 1.5 }}>{guide.summary}</p>
                </div>

                {guide.issue && (
                  <div style={{ padding: 11, borderRadius: 10, background: 'rgba(202,138,4,.12)', border: '1px solid rgba(202,138,4,.28)', color: '#a16207', fontSize: 13, lineHeight: 1.45 }}>
                    {guide.issue}
                  </div>
                )}

                <div>
                  <h3 style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{tr('help.steps_title')}</h3>
                  <ol style={{ display: 'grid', gap: 8, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                    {(guide.steps || []).map((step, idx) => <li key={`${idx}-${step}`}>{step}</li>)}
                  </ol>
                </div>

                {guide.tip && (
                  <div style={{ padding: 11, borderRadius: 10, background: 'rgba(22,163,74,.12)', border: '1px solid rgba(22,163,74,.26)', color: '#15803d', fontSize: 13, lineHeight: 1.45 }}>
                    {guide.tip}
                  </div>
                )}

                {guide.source === 'fallback' && (
                  <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.45 }}>
                    {tr('help.config_hint')}
                  </div>
                )}

                {preview && (
                  <button type="button" className="btn small" onClick={() => setShowPreview(v => !v)}>
                    {showPreview ? tr('help.hide_preview') : tr('help.show_preview')}
                  </button>
                )}
                {showPreview && preview && (
                  <img src={preview} alt={tr('help.preview_alt')} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />
                )}
                <button type="button" className="btn primary small" onClick={handleOpen} disabled={loading}>
                  {tr('help.retry')}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
