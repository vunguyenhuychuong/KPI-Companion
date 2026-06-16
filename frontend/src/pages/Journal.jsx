import { useEffect, useState } from 'react'
import { api, STATUS_COLORS } from '../api'
import { useLang } from '../LangContext'
import { useCycle } from '../CycleContext'
import { ConfirmModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { UiIcon, cleanIconLabel } from '../components/UiIcon'

const PAGE_SIZE = 20

function Pagination({ page, pageSize, total, onPage, tr }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null
  return (
    <div className="pagination">
      <button className="btn small ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <UiIcon name="arrowLeft" />{tr('pagination.prev')}
      </button>
      <span className="pagination-info">{tr('pagination.page', { page, total: totalPages })}</span>
      <button className="btn small ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        {tr('pagination.next')}<UiIcon name="arrowRight" />
      </button>
    </div>
  )
}

function EvidenceTab() {
  const { tr, statusLabels, sourceLabels } = useLang()
  const { activeCycleId } = useCycle()
  const toast = useToast()
  const SL = statusLabels()
  const SRC = sourceLabels()

  const [items, setItems] = useState([])
  const [kpis, setKpis] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deletePending, setDeletePending] = useState(null)
  const [error, setError] = useState('')
  const [savingManual, setSavingManual] = useState(false)
  const [manual, setManual] = useState(() => ({
    kpi_id: '',
    title: '',
    detail: '',
    status: 'da_lam',
    value_delta: '',
    work_date: new Date().toISOString().slice(0, 10),
  }))

  const selectedKpi = kpis.find((k) => String(k.id) === String(manual.kpi_id))
  const selectedProgress = selectedKpi
    ? `${selectedKpi.current_value}/${selectedKpi.target_value} ${selectedKpi.unit || ''}`.trim()
    : ''

  const load = () => {
    const p = new URLSearchParams({ page, page_size: PAGE_SIZE })
    if (status) p.set('status', status)
    if (source) p.set('source', source)
    if (search.trim()) p.set('search', search.trim())
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    api.listWorkItems(`?${p}`)
      .then((res) => { setItems(res.items || []); setTotal(res.total || 0) })
      .catch((e) => setError(e.message))
  }

  useEffect(() => { load() }, [page, status, source, search, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.listKpis(activeCycleId)
      .then((res) => setKpis(res || []))
      .catch((e) => setError(e.message))
  }, [activeCycleId])

  const resetPage = (fn) => {
    setPage(1)
    fn()
  }

  const doDelete = async () => {
    if (!deletePending) return
    try {
      await api.deleteWorkItem(deletePending.id)
      toast.success(tr('journal.delete_success'))
      setDeletePending(null)
      load()
    } catch (e) { setError(e.message) }
  }

  const saveManual = async () => {
    if (!manual.kpi_id) {
      setError(tr('journal.manual_kpi_required'))
      return
    }
    if (!manual.title.trim()) {
      setError(tr('journal.manual_title_required'))
      return
    }
    setSavingManual(true)
    setError('')
    try {
      await api.confirmItems([{
        title: manual.title.trim(),
        detail: manual.detail.trim(),
        status: manual.status,
        kpi_id: Number(manual.kpi_id),
        kpi_name: selectedKpi?.name || '',
        kpi_unit: selectedKpi?.unit || '',
        value_delta: Number(manual.value_delta) || 0,
        source: 'manual',
        source_ref: tr('journal.manual_title'),
        work_date: manual.work_date || null,
      }])
      toast.success(tr('journal.manual_success'))
      setManual({
        kpi_id: '',
        title: '',
        detail: '',
        status: 'da_lam',
        value_delta: '',
        work_date: new Date().toISOString().slice(0, 10),
      })
      setPage(1)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingManual(false)
    }
  }

  return (
    <>
      {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
      <section className="card journal-manual-card">
        <div className="journal-manual-head">
          <div>
            <h3 className="icon-heading"><UiIcon name="edit" /> {cleanIconLabel(tr('journal.manual_title'))}</h3>
            <p>{tr('journal.manual_subtitle')}</p>
          </div>
          <span className="source-badge">{SRC.manual || tr('source.manual')}</span>
        </div>
        <div className="journal-manual-grid">
          <label className="journal-field span-2">{tr('journal.manual_kpi')}
            <select value={manual.kpi_id} onChange={(e) => setManual({ ...manual, kpi_id: e.target.value })}>
              <option value="">{tr('journal.manual_kpi_placeholder')}</option>
              {kpis.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </label>
          <label className="journal-field span-2">{tr('journal.manual_title_label')}
            <input
              value={manual.title}
              placeholder={tr('journal.manual_title_placeholder')}
              onChange={(e) => setManual({ ...manual, title: e.target.value })}
            />
          </label>
          <label className="journal-field">{tr('journal.filter_status')}
            <select value={manual.status} onChange={(e) => setManual({ ...manual, status: e.target.value })}>
              {Object.entries(SL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="journal-field">{tr('journal.manual_delta')}{selectedKpi?.unit ? ` (${selectedKpi.unit})` : ''}
            <input
              type="number"
              step="any"
              value={manual.value_delta}
              placeholder="0"
              onChange={(e) => setManual({ ...manual, value_delta: e.target.value })}
            />
          </label>
          <label className="journal-field">{tr('journal.manual_date')}
            <input type="date" value={manual.work_date} onChange={(e) => setManual({ ...manual, work_date: e.target.value })} />
          </label>
          <div className="journal-manual-kpi">
            <span>{tr('journal.manual_selected')}</span>
            <b>{selectedKpi ? selectedProgress : tr('journal.manual_no_kpi')}</b>
          </div>
          <label className="journal-field full">{tr('journal.manual_detail')}
            <textarea
              rows={2}
              value={manual.detail}
              placeholder={tr('journal.manual_detail_placeholder')}
              onChange={(e) => setManual({ ...manual, detail: e.target.value })}
            />
          </label>
        </div>
        <div className="journal-manual-footer">
          <span>{selectedKpi ? tr('journal.manual_delta_hint', { unit: selectedKpi.unit || '' }) : tr('journal.manual_pick_hint')}</span>
          <button className="btn primary" onClick={saveManual} disabled={savingManual}>
            <UiIcon name="check" />{tr('journal.manual_save')}
          </button>
        </div>
      </section>
      <div className="journal-filter-row evidence-filters">
        <label>{tr('journal.filter_status')}
          <select value={status} onChange={(e) => resetPage(() => setStatus(e.target.value))}>
            <option value="">{tr('journal.filter_all')}</option>
            {Object.entries(SL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>{tr('journal.filter_source')}
          <select value={source} onChange={(e) => resetPage(() => setSource(e.target.value))}>
            <option value="">{tr('journal.filter_all')}</option>
            {Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>{tr('journal.filter_from')}
          <input type="date" value={dateFrom} onChange={(e) => resetPage(() => setDateFrom(e.target.value))} />
        </label>
        <label>{tr('journal.filter_to')}
          <input type="date" value={dateTo} onChange={(e) => resetPage(() => setDateTo(e.target.value))} />
        </label>
        <label className="journal-search">{tr('journal.filter_search')}
          <input placeholder={tr('journal.search_placeholder')} value={search} onChange={(e) => resetPage(() => setSearch(e.target.value))} />
        </label>
        <span className="muted">{tr('journal.count', { filtered: items.length, total })}</span>
      </div>
      <div className="card">
        {items.length === 0 ? <p className="muted">{tr('journal.no_match')}</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>{tr('journal.col_work_date')}</th>
                <th>{tr('journal.col_recorded')}</th>
                <th>{tr('journal.col_task')}</th>
                <th>{tr('journal.col_status')}</th>
                <th>{tr('journal.col_kpi')}</th>
                <th>{tr('journal.col_delta')}</th>
                <th>{tr('journal.col_source')}</th>
                <th>{tr('journal.col_origin')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id}>
                  <td className="nowrap">{w.work_date || <span className="muted">—</span>}</td>
                  <td className="nowrap muted">{w.created_at?.slice(0, 19).replace('T', ' ')}</td>
                  <td>{w.title}</td>
                  <td><span className="status-chip" style={{ color: STATUS_COLORS[w.status] }}>{SL[w.status] ?? w.status}</span></td>
                  <td>{w.kpi_name || <span className="muted">{tr('journal.no_kpi')}</span>}</td>
                  <td>{w.progress_delta ? `${w.progress_delta > 0 ? '+' : ''}${w.progress_delta}` : '—'}</td>
                  <td className="nowrap">{SRC[w.source] ?? w.source}</td>
                  <td className="muted">{w.source_ref}</td>
                  <td className="nowrap">
                    <button className="btn small danger" onClick={() => setDeletePending(w)}>
                      <UiIcon name="trash" />{tr('journal.delete_permanent')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} tr={tr} />
      </div>
      <ConfirmModal
        open={!!deletePending}
        title={tr('journal.delete_permanent')}
        message={deletePending ? tr('journal.delete_work_confirm', { name: deletePending.title }) : ''}
        confirmLabel={tr('journal.delete_permanent')}
        confirmVariant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeletePending(null)}
      />
    </>
  )
}

function HistoryTab() {
  const { tr } = useLang()
  const toast = useToast()
  const [restorePending, setRestorePending] = useState(null)
  const [deleteKpiPending, setDeleteKpiPending] = useState(null)
  const [logs, setLogs] = useState([])
  const [totalLogs, setTotalLogs] = useState(0)
  const [page, setPage] = useState(1)
  const [archived, setArchived] = useState([])
  const [field, setField] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const FIELD_LABELS = {
    name: tr('journal.field_name'),
    description: tr('journal.field_description'),
    target: tr('journal.field_target'),
    weight: tr('journal.field_weight'),
    deadline: tr('journal.field_deadline'),
    unit: tr('journal.field_unit'),
    target_value: tr('journal.field_target_value'),
    current_value: tr('journal.field_current_value'),
    progress: tr('journal.field_progress'),
    objective: tr('journal.field_objective'),
    archived: tr('journal.field_archived'),
    category: tr('journal.field_category'),
  }

  const loadLogs = () => {
    const p = new URLSearchParams({ page, page_size: PAGE_SIZE })
    if (field) p.set('field', field)
    if (search.trim()) p.set('search', search.trim())
    return api.allChangelog(`?${p}`)
      .then((res) => { setLogs(res.items || []); setTotalLogs(res.total || 0) })
  }

  const load = () =>
    Promise.all([loadLogs(), api.archivedKpis()])
      .then(([, a]) => setArchived(a || []))
      .catch((e) => setError(e.message))

  useEffect(() => { load() }, [page, field, search]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetPage = (fn) => {
    setPage(1)
    fn()
  }

  const doRestore = async () => {
    if (!restorePending) return
    try {
      await api.restoreKpi(restorePending.id)
      setRestorePending(null)
      load()
    } catch (e) { setError(e.message) }
  }

  const doDeleteKpi = async () => {
    if (!deleteKpiPending) return
    try {
      await api.deleteKpiPermanent(deleteKpiPending.id)
      toast.success(tr('journal.delete_success'))
      setDeleteKpiPending(null)
      load()
    } catch (e) { setError(e.message) }
  }

  return (
    <>
      {error && <div className="error-text"><UiIcon name="warning" /> {error}</div>}
      {archived.length > 0 && (
        <div className="card">
          <h3 className="icon-heading"><UiIcon name="archive" /> {cleanIconLabel(tr('journal.archived_kpis', { count: archived.length }))}</h3>
          {archived.map((k) => (
            <div className="todo-row" key={k.id}>
              <div className="todo-main">
                <span className="todo-title">{k.name}</span>
                <span className="muted">
                  {k.unit === '%' ? `Actual ${k.current_value}%` : `Actual ${k.current_value}/${k.target_value} ${k.unit}`}
                  {k.objective_name ? <> · <span className="inline-ui-icon"><UiIcon name="flag" /></span> {k.objective_name}</> : ''}
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn small" onClick={() => setRestorePending(k)}><UiIcon name="restore" />{cleanIconLabel(tr('journal.restore'))}</button>
                <button className="btn small danger" onClick={() => setDeleteKpiPending(k)}><UiIcon name="trash" />{tr('journal.delete_permanent')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="journal-filter-row history-filters">
        <label>{tr('journal.filter_field')}
          <select value={field} onChange={(e) => resetPage(() => setField(e.target.value))}>
            <option value="">{tr('journal.filter_all')}</option>
            {Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="journal-search">{tr('journal.filter_search')}
          <input placeholder={tr('journal.history_search_placeholder')} value={search} onChange={(e) => resetPage(() => setSearch(e.target.value))} />
        </label>
        <span className="muted">{tr('journal.history_count', { filtered: logs.length, total: totalLogs })}</span>
      </div>

      <div className="card">
        <h3 className="icon-heading"><UiIcon name="clock" /> {cleanIconLabel(tr('journal.changelog_all', { count: totalLogs }))}</h3>
        {logs.length === 0 ? <p className="muted">{tr('journal.no_changes')}</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>{tr('journal.col_time')}</th>
                <th>{tr('journal.col_kpi_name')}</th>
                <th>{tr('journal.col_field')}</th>
                <th>{tr('journal.col_old')}</th>
                <th>{tr('journal.col_new')}</th>
                <th>{tr('journal.col_reason')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{l.changed_at?.slice(0, 19).replace('T', ' ')}</td>
                  <td>{l.kpi_name || <span className="muted">{tr('journal.kpi_unavailable')}</span>}</td>
                  <td className="nowrap">{FIELD_LABELS[l.field] || l.field}</td>
                  <td>{l.old_value}</td>
                  <td><b>{l.new_value}</b></td>
                  <td className="muted">{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={totalLogs} onPage={setPage} tr={tr} />
      </div>

      <ConfirmModal
        open={!!restorePending}
        title={tr('journal.restore')}
        message={restorePending ? tr('journal.restore_confirm', { name: restorePending.name }) : ''}
        confirmLabel={tr('journal.restore')}
        onConfirm={doRestore}
        onCancel={() => setRestorePending(null)}
      />
      <ConfirmModal
        open={!!deleteKpiPending}
        title={tr('journal.delete_permanent')}
        message={deleteKpiPending ? tr('journal.delete_kpi_confirm', { name: deleteKpiPending.name }) : ''}
        confirmLabel={tr('journal.delete_permanent')}
        confirmVariant="danger"
        onConfirm={doDeleteKpi}
        onCancel={() => setDeleteKpiPending(null)}
      />
    </>
  )
}

export default function Journal() {
  const { tr } = useLang()
  const toast = useToast()
  const [tab, setTab] = useState('evidence')
  return (
    <div className="page journal-page">
      <header className="page-header row">
        <div>
          <h1 className="page-title-with-icon"><UiIcon name="bookOpen" /> {cleanIconLabel(tr('journal.title'))}</h1>
          <p>{tr('journal.subtitle')}</p>
        </div>
        <button className="btn" onClick={() => api.exportData(['xlsx'], ['work_items', 'changelog']).catch((e) => toast.error(e.message))}>
          <UiIcon name="download" />{cleanIconLabel(tr('journal.export'))}
        </button>
      </header>
      <div className="period-tabs">
        <button className={`period-tab ${tab === 'evidence' ? 'active' : ''}`} onClick={() => setTab('evidence')}>
          <UiIcon name="clipboardList" />{cleanIconLabel(tr('journal.tab_evidence'))}
        </button>
        <button className={`period-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <UiIcon name="clock" />{cleanIconLabel(tr('journal.tab_history'))}
        </button>
      </div>
      {tab === 'evidence' ? <EvidenceTab /> : <HistoryTab />}
    </div>
  )
}
