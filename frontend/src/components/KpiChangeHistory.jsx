import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLang } from '../LangContext'
import { ConfirmModal } from './Modal'
import { useToast } from './Toast'
import { UiIcon, cleanIconLabel } from './UiIcon'

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

export default function KpiChangeHistory() {
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

  const exportHistory = () => {
    api.exportData(['xlsx'], ['changelog']).catch((e) => toast.error(e.message))
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
    <section className="kpi-history-panel">
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
                  {k.objective_name ? <> - <span className="inline-ui-icon"><UiIcon name="flag" /></span> {k.objective_name}</> : ''}
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
      </div>
      <div className="journal-tab-tools">
        <span className="muted">{tr('journal.history_count', { filtered: logs.length, total: totalLogs })}</span>
        <button className="btn small" type="button" onClick={exportHistory}>
          <UiIcon name="download" /><span className="btn-label">{tr('journal.export_history')}</span>
        </button>
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
    </section>
  )
}
