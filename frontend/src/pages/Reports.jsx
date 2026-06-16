import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import Highcharts from 'highcharts'
import { api } from '../api'
import { useLang } from '../LangContext'
import { useCycle } from '../CycleContext'
import { prefs } from '../prefs'
import { Modal, ConfirmModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { UiIcon, cleanIconLabel } from '../components/UiIcon'

function now() { return new Date() }

function CycleCompareChart({ tr }) {
  const [cycles, setCycles] = useState([])
  const [selected, setSelected] = useState([])
  const [compareData, setCompareData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const chartRef = useRef(null)
  const chartInstance = useRef(null)

  useEffect(() => {
    api.listCycles().then(setCycles).catch((e) => setError(e.message))
  }, [])

  const toggle = (id) => setSelected((prev) =>
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  )

  const doCompare = async () => {
    if (selected.length < 2) return
    setLoading(true); setError('')
    try {
      const data = await api.compareCycles(selected)
      setCompareData(data)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  // Collect all unique objective names across all selected cycles
  const allObjectiveNames = compareData
    ? [...new Set(compareData.flatMap((c) => c.objectives.map((o) => o.name)))]
    : []

  useEffect(() => {
    if (!compareData || !chartRef.current) return
    if (chartInstance.current) chartInstance.current.destroy()

    const series = compareData.map((cycle) => ({
      name: cycle.name,
      data: allObjectiveNames.map((name) => {
        const obj = cycle.objectives.find((o) => o.name === name)
        return obj ? obj.progress : null
      }),
    }))

    // Append avg_progress as an extra point
    const avgSeries = {
      name: tr('reports.compare_avg'),
      type: 'spline',
      dashStyle: 'Dash',
      marker: { symbol: 'diamond', radius: 5 },
      data: compareData.map((c) => ({ name: c.name, y: c.avg_progress })),
      xAxis: 1,
    }

    const categories = allObjectiveNames

    chartInstance.current = Highcharts.chart(chartRef.current, {
      chart: { type: 'column', style: { fontFamily: 'inherit' }, backgroundColor: 'transparent' },
      title: { text: tr('reports.compare_chart_title'), style: { color: 'var(--text)', fontSize: '14px' } },
      xAxis: [
        { categories, crosshair: true, labels: { style: { color: 'var(--text-muted)' } } },
        { categories: compareData.map((c) => c.name), opposite: true, labels: { style: { color: 'var(--text-muted)' } } },
      ],
      yAxis: {
        min: 0, max: 100,
        title: { text: tr('reports.compare_y_axis'), style: { color: 'var(--text-muted)' } },
        labels: { format: '{value}%', style: { color: 'var(--text-muted)' } },
        plotLines: [{ value: 100, color: '#22c55e', width: 1, dashStyle: 'Dot' }],
      },
      tooltip: { valueSuffix: '%', shared: true },
      plotOptions: { column: { grouping: true, pointPadding: 0.1, borderWidth: 0 } },
      legend: { itemStyle: { color: 'var(--text)' } },
      series: [...series, avgSeries],
      credits: { enabled: false },
    })
  }, [compareData])

  // Cleanup on unmount
  useEffect(() => () => { if (chartInstance.current) chartInstance.current.destroy() }, [])

  if (cycles.length === 0 && !error) return <p className="muted">{tr('reports.compare_no_cycles')}</p>

  return (
    <div>
      {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
      <p className="muted" style={{ marginBottom: 8 }}>{tr('reports.compare_hint')}</p>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{tr('reports.compare_select_label')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {cycles.map((c) => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)', background: selected.includes(c.id) ? 'var(--primary)' : 'var(--surface)', color: selected.includes(c.id) ? '#fff' : 'var(--text)', fontSize: 13 }}>
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} style={{ display: 'none' }} />
              {c.name}
              {c.is_locked && <span className="inline-ui-icon" style={{ opacity: 0.8 }}><UiIcon name="lock" /></span>}
            </label>
          ))}
        </div>
      </div>
      <button className="btn primary" onClick={doCompare} disabled={selected.length < 2 || loading} style={{ marginBottom: 16 }}>
        <UiIcon name="table" />{loading ? tr('reports.compare_loading') : cleanIconLabel(tr('reports.compare_btn'))}
      </button>

      {compareData && allObjectiveNames.length === 0 && (
        <p className="muted">{tr('reports.compare_no_objectives')}</p>
      )}
      {compareData && allObjectiveNames.length > 0 && (
        <div ref={chartRef} style={{ width: '100%', minHeight: 360 }} />
      )}
      {!compareData && !loading && (
        <p className="muted">{tr('reports.compare_empty')}</p>
      )}
    </div>
  )
}

export default function Reports() {
  const { tr } = useLang()
  const { activeCycleId } = useCycle()
  const toast = useToast()

  const PERIODS = [
    { key: 'week', label: cleanIconLabel(tr('reports.tab_week')), icon: 'calendar' },
    { key: 'month', label: cleanIconLabel(tr('reports.tab_month')), icon: 'calendar' },
    { key: 'quarter', label: cleanIconLabel(tr('reports.tab_quarter')), icon: 'table' },
    { key: 'year', label: cleanIconLabel(tr('reports.tab_year')), icon: 'target' },
    { key: 'self_review', label: cleanIconLabel(tr('reports.tab_self_review')), icon: 'fileText' },
    { key: 'compare', label: cleanIconLabel(tr('reports.tab_compare')), icon: 'scan' },
  ]

  const [saved, setSaved] = useState([])
  const [periodType, setPeriodType] = useState('week')
  const [weekDate, setWeekDate] = useState(now().toISOString().slice(0, 10))
  const [month, setMonth] = useState(`${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}`)
  const [quarter, setQuarter] = useState(`Q${Math.floor(now().getMonth() / 3) + 1}/${now().getFullYear()}`)
  const [year, setYear] = useState(String(now().getFullYear()))
  const [busy, setBusy] = useState(false)
  const [secs, setSecs] = useState(0)
  const [viewing, setViewing] = useState(null)
  const [error, setError] = useState('')

  // Modal states
  const [showExportConfirm, setShowExportConfirm] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)
  const [previewContent, setPreviewContent] = useState('')
  const [previewSubject, setPreviewSubject] = useState('')

  // Send form
  const [mgrChannel, setMgrChannel] = useState(prefs.getMgrChannel())
  const [mgrTo, setMgrTo] = useState(prefs.getMgrRecipient())
  const [mgrBusy, setMgrBusy] = useState(false)
  const [mgrResult, setMgrResult] = useState(null)

  // Edit textarea ref for formatting
  const editTextareaRef = useRef(null)

  const load = () => api.savedReports().then(setSaved).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!busy) { setSecs(0); return }
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  const [exportingFormat, setExportingFormat] = useState(null)

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      let report
      if (periodType === 'self_review') {
        report = await api.generateSelfReview()
      } else {
        const label = periodType === 'week' ? weekDate
          : periodType === 'month' ? month
          : periodType === 'quarter' ? quarter
          : year
        report = await api.generateReport(periodType, label)
      }
      setViewing(report)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const exportReport = async (format) => {
    if (!viewing) return
    setExportingFormat(format)
    setError('')
    try {
      await api.exportSavedReport(viewing.id, format)
    } catch (e) { setError(e.message) } finally { setExportingFormat(null) }
  }

  const regenerate = async () => {
    if (!viewing) return
    setBusy(true)
    setError('')
    try {
      const report = await api.regenerateReport(viewing.id)
      setViewing(report)
      load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const doDelete = async () => {
    if (!deleteConfirm) return
    await api.deleteReport(deleteConfirm)
    if (viewing?.id === deleteConfirm) setViewing(null)
    setDeleteConfirm(null)
    load()
  }

  const copy = () => {
    navigator.clipboard.writeText(viewing.content)
      .then(() => toast.success(tr('reports.copy_success')))
  }

  const doExport = () => {
    setShowExportConfirm(true)
  }

  const confirmExport = async () => {
    setShowExportConfirm(false)
    setBusy(true)
    try {
      await api.exportEvaluation(activeCycleId)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  // Step 1: Open edit modal
  const openEditModal = () => {
    if (!viewing) return
    setPreviewContent(viewing.content)
    setPreviewSubject(viewing.period_label)
    setShowEditModal(true)
  }

  // Step 2: From edit go to send
  const openSendModal = () => {
    setMgrResult(null)
    setShowSendModal(true)
  }

  const doSend = async () => {
    if (!mgrTo.trim()) {
      setError(tr('export.recipient_required'))
      return
    }
    setMgrBusy(true); setError('')
    try {
      const result = await api.sendToManager(mgrChannel, mgrTo.trim(), previewSubject, previewContent)
      setMgrResult(result)
    } catch (e) { setError(e.message) } finally { setMgrBusy(false) }
  }

  // === Toolbar formatting helpers ===
  const insertFormat = (format) => {
    const textarea = editTextareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = previewContent
    const selected = text.substring(start, end)
    let newText, newCursor

    switch (format) {
      case 'bold':
        newText = text.substring(0, start) + `**${selected}**` + text.substring(end)
        newCursor = start + 2 + selected.length
        break
      case 'italic':
        newText = text.substring(0, start) + `*${selected}*` + text.substring(end)
        newCursor = start + 1 + selected.length
        break
      case 'underline':
        newText = text.substring(0, start) + `<u>${selected}</u>` + text.substring(end)
        newCursor = start + 3 + selected.length
        break
      case 'list':
        newText = text.substring(0, start) + `\n- ${selected}` + text.substring(end)
        newCursor = start + 3 + selected.length
        break
      case 'list_num':
        newText = text.substring(0, start) + `\n1. ${selected}` + text.substring(end)
        newCursor = start + 4 + selected.length
        break
      case 'quote':
        newText = text.substring(0, start) + `\n> ${selected}` + text.substring(end)
        newCursor = start + 3 + selected.length
        break
      case 'link':
        newText = text.substring(0, start) + `[${selected}](url)` + text.substring(end)
        newCursor = start + 1 + selected.length
        break
      default:
        return
    }
    setPreviewContent(newText)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursor, newCursor)
    }, 0)
  }

  return (
    <div className="page">
      <header className="page-header row">
        <div>
          <h1 className="page-title-with-icon"><UiIcon name="fileText" /> {cleanIconLabel(tr('reports.title'))}</h1>
          <p>{tr('reports.subtitle')}</p>
        </div>
        <button className="btn" onClick={doExport} disabled={busy}>
          <UiIcon name="download" />{cleanIconLabel(tr('reports.export'))}
        </button>
      </header>

      <div className="card report-controls">
        <div className="period-tabs">
          {PERIODS.map((p) => (
            <button key={p.key}
              className={`period-tab ${periodType === p.key ? 'active' : ''}`}
              onClick={() => setPeriodType(p.key)}>
              <UiIcon name={p.icon} />{p.label}
            </button>
          ))}
        </div>
        {periodType === 'compare' ? null : periodType === 'self_review' ? (
          <div className="form-row" style={{ alignItems: 'center' }}>
            <p className="muted" style={{ margin: 0, flex: 1 }}>{tr('reports.self_review_hint')}</p>
            <button className="btn primary" onClick={generate} disabled={busy}>
              <UiIcon name="sparkles" />{busy ? tr('reports.generating', { secs }) : tr('reports.self_review_btn')}
            </button>
          </div>
        ) : (
          <>
            <div className="form-row">
              {periodType === 'week' && (
                <label>{tr('reports.label_week')}
                  <input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value)} />
                </label>
              )}
              {periodType === 'month' && (
                <label>{tr('reports.label_month')}
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                </label>
              )}
              {periodType === 'quarter' && (
                <label>{tr('reports.label_quarter')}
                  <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                    {[now().getFullYear() - 1, now().getFullYear()].flatMap((y) =>
                      [1, 2, 3, 4].map((q) => (
                        <option key={`${q}-${y}`} value={`Q${q}/${y}`}>Q{q}/{y}</option>
                      )),
                    )}
                  </select>
                </label>
              )}
              {periodType === 'year' && (
                <label>{tr('reports.label_year')}
                  <input type="number" style={{ width: 100 }} value={year} onChange={(e) => setYear(e.target.value)} />
                </label>
              )}
              <button className="btn primary" onClick={generate} disabled={busy}>
                <UiIcon name="sparkles" />{busy ? tr('reports.generating', { secs }) : cleanIconLabel(tr('reports.generate_btn'))}
              </button>
            </div>
            <p className="muted report-note" style={{ marginTop: 8 }}>
              <UiIcon name="sparkles" />
              <span dangerouslySetInnerHTML={{ __html: marked.parseInline(cleanIconLabel(tr('reports.overwrite_note'))) }} />
            </p>
          </>
        )}
      </div>

      {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}

      {periodType === 'compare' && (
        <div className="card" style={{ padding: '20px 24px' }}>
          <CycleCompareChart tr={tr} />
        </div>
      )}

      <div className="report-layout" style={{ display: periodType === 'compare' ? 'none' : undefined }}>
        <div className="report-list">
          <h3 className="muted">{tr('reports.list_title')}</h3>
          {saved.length === 0 && <p className="muted">{tr('reports.no_reports')}</p>}
          {saved.map((r) => (
            <div key={r.id}
              className={`report-item ${viewing?.id === r.id ? 'active' : ''}`}
              onClick={() => setViewing(r)}>
              <div>
                <b>{r.period_label}</b>
                <div className="muted">{r.created_at?.slice(0, 16).replace('T', ' ')}</div>
              </div>
              <button className="btn-icon" title={tr('reports.delete_title')} onClick={(e) => { e.stopPropagation(); setDeleteConfirm(r.id) }}><UiIcon name="trash" /></button>
            </div>
          ))}
        </div>

        <div className="report-view card">
          {viewing ? (
            <>
              <div className="report-view-head">
                <span className="muted">{tr('reports.updated_at', { time: viewing.created_at?.slice(0, 16).replace('T', ' ') })}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {viewing.period_type === 'self_review' && (
                    <button className="btn small" onClick={() => exportReport('pdf')}
                      disabled={exportingFormat !== null}
                      title={tr('reports.export_pdf_title')}>
                      <UiIcon name="fileText" />{exportingFormat === 'pdf' ? '...' : tr('reports.export_pdf_btn')}
                    </button>
                  )}
                  <button className="btn small primary" onClick={openEditModal}>
                    <UiIcon name="edit" />{cleanIconLabel(tr('reports.edit_send'))}
                  </button>
                  <button className="btn small" onClick={regenerate} disabled={busy}
                    title={tr('reports.regenerate_tooltip')}>
                    <UiIcon name="refresh" />{busy ? tr('reports.regenerating', { secs }) : cleanIconLabel(tr('reports.regenerate_btn'))}
                  </button>
                  <button className="btn small" onClick={copy}><UiIcon name="copy" />{cleanIconLabel(tr('reports.copy_btn'))}</button>
                </div>
              </div>
              <div className="report-content" dangerouslySetInnerHTML={{ __html: marked.parse(viewing.content) }} />
            </>
          ) : (
            <p className="muted"
              dangerouslySetInnerHTML={{ __html: marked.parseInline(tr('reports.empty_view')) }}
            />
          )}
        </div>
      </div>

      {/* Export confirmation modal */}
      <Modal
        open={showExportConfirm}
        title={tr('reports.export_confirm')}
        onClose={() => setShowExportConfirm(false)}
        actions={
          <>
            <button className="btn" onClick={() => setShowExportConfirm(false)}>{tr('common.cancel')}</button>
            <button className="btn primary" onClick={confirmExport}><UiIcon name="download" />{cleanIconLabel(tr('reports.export'))}</button>
          </>
        }
      >
        <p>{tr('reports.export_confirm_msg')}</p>
      </Modal>

      {/* Step 1: Edit content */}
      <Modal
        open={showEditModal}
        title={tr('reports.edit_title')}
        onClose={() => setShowEditModal(false)}
        wide={true}
        actions={
          <>
            <button className="btn" onClick={() => setShowEditModal(false)}>{tr('common.cancel')}</button>
            <button className="btn primary" onClick={async () => {
              if (!mgrTo.trim()) {
                setError(tr('export.recipient_required'))
                return
              }
              setShowEditModal(false)
              setMgrBusy(true)
              try {
                const result = await api.sendToManager('email', mgrTo.trim(), previewSubject, previewContent)
                setMgrResult(result)
                if (!result.mocked) {
                  toast.success(tr('reports.email_sent'))
                } else {
                  toast.info(result.note)
                }
              } catch (e) {
                setError(e.message)
              } finally {
                setMgrBusy(false)
              }
            }} disabled={mgrBusy || !mgrTo.trim()}>
              <UiIcon name="mail" />{mgrBusy ? tr('export.sending') : cleanIconLabel(tr('reports.send_email_btn'))}
            </button>
            <button className="btn" onClick={() => { setShowEditModal(false); openSendModal() }}>
              <UiIcon name="send" />
              {tr('reports.continue_send')}
            </button>
          </>
        }
      >
        <div className="modal-field" style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label>{tr('reports.subject_label')}</label>
            <input
              value={previewSubject}
              onChange={(e) => setPreviewSubject(e.target.value)}
              placeholder={tr('reports.subject_ph')}
              style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>{tr('reports.email_to_label')}</label>
            <input
              type="email"
              value={mgrTo}
              onChange={(e) => setMgrTo(e.target.value)}
              placeholder={tr('reports.email_to_placeholder')}
              style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }}
            />
          </div>
        </div>
        <div className="modal-field">
          <label>{tr('reports.content_label')}</label>
          <div className="format-toolbar">
            <button type="button" className="format-btn" title={tr('reports.format_bold')} onClick={() => insertFormat('bold')}>B</button>
            <button type="button" className="format-btn italic" title={tr('reports.format_italic')} onClick={() => insertFormat('italic')}>I</button>
            <button type="button" className="format-btn underline" title={tr('reports.format_underline')} onClick={() => insertFormat('underline')}>U</button>
            <span className="format-sep">|</span>
            <button type="button" className="format-btn" title={tr('reports.format_list')} onClick={() => insertFormat('list')}>•</button>
            <button type="button" className="format-btn" title={tr('reports.format_list_num')} onClick={() => insertFormat('list_num')}>1.</button>
            <button type="button" className="format-btn" title={tr('reports.format_quote')} onClick={() => insertFormat('quote')}>&gt;</button>
            <button type="button" className="format-btn" title={tr('reports.format_link')} onClick={() => insertFormat('link')}><UiIcon name="link" /></button>
          </div>
          <textarea
            ref={editTextareaRef}
            value={previewContent}
            onChange={(e) => setPreviewContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.ctrlKey || e.metaKey) {
                if (e.key === 'b') { e.preventDefault(); insertFormat('bold') }
                else if (e.key === 'i') { e.preventDefault(); insertFormat('italic') }
                else if (e.key === 'u') { e.preventDefault(); insertFormat('underline') }
              }
            }}
            rows={10}
            style={{ width: '100%', minHeight: 150, resize: 'vertical', fontFamily: 'inherit', fontSize: 13, padding: 10, borderRadius: '0 0 10px 10px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          />
          <p className="muted" style={{ marginTop: 4, fontSize: 11 }}>
            {tr('reports.format_hint')}
          </p>
        </div>
        <div style={{ marginTop: 8 }}>
          <p style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{tr('reports.preview_label')}</p>
          <div className="report-content" style={{ maxHeight: 200, overflow: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 10 }} dangerouslySetInnerHTML={{ __html: marked.parse(previewContent) }} />
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteConfirm}
        title={tr('reports.delete_title')}
        message={tr('reports.delete_confirm')}
        confirmLabel={tr('reports.delete_title')}
        confirmVariant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Step 2: Enter recipient and send */}
      <Modal
        open={showSendModal}
        title={tr('reports.send_title')}
        onClose={() => setShowSendModal(false)}
        wide={true}
        actions={
          <>
            <button className="btn" onClick={() => setShowSendModal(false)}>{tr('common.cancel')}</button>
            <button className="btn primary" onClick={doSend} disabled={mgrBusy || !mgrTo.trim()}>
              <UiIcon name="send" />{mgrBusy ? tr('export.sending') : tr('export.send_btn')}
            </button>
          </>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{tr('reports.preview_label')}</p>
          <div className="report-content" style={{ maxHeight: 180, overflow: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 10 }} dangerouslySetInnerHTML={{ __html: marked.parse(previewContent) }} />
        </div>

        <div className="modal-field">
          <label>{tr('export.channel_label')}</label>
          <select value={mgrChannel} onChange={(e) => { setMgrChannel(e.target.value); setMgrResult(null) }}
            style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }}>
            <option value="email">{tr('export.channel_email')}</option>
            <option value="webhook">{tr('export.channel_webhook')}</option>
          </select>
        </div>
        <div className="modal-field">
          <label>{tr('export.recipient_label')}</label>
          <input
            className="export-recipient"
            placeholder={mgrChannel === 'email' ? tr('export.recipient_ph_email') : tr('export.recipient_ph_webhook')}
            value={mgrTo}
            onChange={(e) => setMgrTo(e.target.value)}
            style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }}
          />
        </div>

        {error && <div className="error-text" style={{ marginBottom: 12 }}><UiIcon name="warning" /> {error}</div>}

        {mgrResult && (
          <div className="manager-preview" style={{ marginTop: 16 }}>
            <div className="manager-preview-head">
              <span className="mock-badge">{tr('export.mock_badge')}</span>
              <span>{tr('export.preview_title', { recipient: mgrResult.recipient })}</span>
            </div>
            <div className="manager-subject"><b>{mgrResult.subject}</b></div>
            <div className="report-content" dangerouslySetInnerHTML={{ __html: marked.parse(mgrResult.body || '') }} />
            <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{mgrResult.note}</p>
          </div>
        )}
      </Modal>

    </div>
  )
}
