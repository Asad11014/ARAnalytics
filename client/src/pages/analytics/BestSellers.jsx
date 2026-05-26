import { useState } from 'react'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import useReportFilters   from '../../lib/useReportFilters'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'
import MultiSelect   from '../../components/MultiSelect'

export default function BestSellers() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [days,    setDays]    = useState(30)
  const [limit,   setLimit]   = useState(20)
  const [result,  setResult]  = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const [view,    setView]    = useState('top')

  const {
    selectedClients, setSelectedClients,
    selectedStatuses, setSelectedStatuses,
    availableStatuses, clientOptions, clientIds, statuses,
  } = useReportFilters(session, warehouseId)

  // If sidebar has a single client selected, ignore multi-select and use that
  const singleClientId = session?.isWarehouse ? selectedClientId : session?.clientId

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setResult(null)
    try {
      const url = buildReportURL('best-sellers', {
        warehouseId,
        clientId:  singleClientId && !clientIds.length ? singleClientId : undefined,
        clientIds: singleClientId ? [] : clientIds,
        statuses,
        days,
        limit,
      })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setResult(res)
      setStatus({ msg: `${res.meta?.totalSkus || 0} SKUs across ${res.meta?.totalOrders || 0} orders`, type: 'success' })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { key: 'rank',       label: '#',           render: r => <span className="text-ink-dim font-mono">{r.rank}</span> },
    { key: 'sku',        label: 'SKU',         render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',       label: 'Product',     render: r => <span className="text-ink-muted text-xs">{r.name || '—'}</span> },
    { key: 'totalSold',  label: 'Units Sold',  align: 'right', render: r => <strong>{r.totalSold?.toLocaleString()}</strong> },
    { key: 'orderCount', label: 'Orders',      align: 'right' },
    { key: 'activeDays', label: 'Active Days', align: 'right' },
  ]

  const rows = view === 'top' ? (result?.topSellers || []) : (result?.worstSellers || [])

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Best & Worst Sellers</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Rank SKUs by units sold over any period</div>
        </div>
        {result && (
          <button onClick={() => exportCSV(`${view}-sellers.csv`, columns, rows)}
            className="border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">
            Export CSV
          </button>
        )}
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-3 sm:py-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Parameters</div>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Period (days)</label>
              <input type="number" min={1} value={days} onChange={e => setDays(Number(e.target.value))}
                className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-28 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Show top / bottom N</label>
              <input type="number" min={1} value={limit} onChange={e => setLimit(Number(e.target.value))}
                className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-28 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
            </div>
            {/* Multi-client filter — only for warehouse users without a sidebar client selected */}
            {session?.isWarehouse && !singleClientId && clientOptions.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Clients</label>
                <MultiSelect label="All clients" options={clientOptions} value={selectedClients} onChange={setSelectedClients} />
              </div>
            )}
            {availableStatuses.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Order Status</label>
                <MultiSelect label="All statuses" options={availableStatuses.map(s => ({ value: s, label: s }))} value={selectedStatuses} onChange={setSelectedStatuses} />
              </div>
            )}
            <button onClick={run} disabled={loading}
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-5 py-2 h-9 transition-colors disabled:opacity-50">
              {loading ? '⟳ Running…' : '▶ Run Report'}
            </button>
          </div>
        </div>

        <StatusBar message={status.msg} type={status.type} />

        {result && (
          <>
            <div className="flex gap-3 flex-wrap">
              <StatCard label="Total SKUs"   value={result.meta?.totalSkus} />
              <StatCard label="Total Orders" value={result.meta?.totalOrders?.toLocaleString()} accent="primary" />
            </div>

            <div className="flex gap-2">
              {[{ id: 'top', label: '🏆 Top Sellers' }, { id: 'worst', label: '🔻 Worst Sellers' }].map(t => (
                <button key={t.id} onClick={() => setView(t.id)}
                  className={`px-4 py-1.5 rounded font-mono text-xs border transition-colors ${view === t.id ? 'bg-primary text-white border-primary' : 'bg-brand-surface border-brand-border text-ink-muted hover:border-primary hover:text-primary'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            <SortableTable columns={columns} rows={rows} emptyMessage="No sales data found." />
          </>
        )}
      </div>
    </div>
  )
}
