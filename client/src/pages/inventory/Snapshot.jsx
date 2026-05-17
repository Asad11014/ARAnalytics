import { useState } from 'react'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'
import Badge         from '../../components/Badge'

const STATUS_VARIANT = { 'out-of-stock': 'danger', 'low-stock': 'warning', 'no-movement': 'muted', 'overstock': 'warning', 'healthy': 'success' }
const STATUS_LABEL   = { 'out-of-stock': 'Out of Stock', 'low-stock': 'Low Stock', 'no-movement': 'No Movement', 'overstock': 'Overstock', 'healthy': 'Healthy' }

export default function Snapshot() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [days,    setDays]    = useState(30)
  const [rows,    setRows]    = useState(null)
  const [meta,    setMeta]    = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const [filter,  setFilter]  = useState('')
  const clientId = session?.isWarehouse ? selectedClientId : session?.clientId

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setRows(null)
    try {
      const url = buildReportURL('inventory-snapshot', { warehouseId, clientId, days })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setRows(res.rows || []); setMeta(res.meta || {})
      setStatus({ msg: `${(res.rows||[]).length} SKUs loaded`, type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }

  const filtered = filter && rows ? rows.filter(r => r.status === filter) : rows

  const columns = [
    { key: 'sku',         label: 'SKU',         render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',        label: 'Product',     render: r => <span className="text-ink-muted text-xs">{r.name||'—'}</span> },
    { key: 'stock',       label: 'In Stock',    align: 'right', render: r => <strong>{r.stock?.toLocaleString()}</strong> },
    { key: 'sold',        label: `Sold (${days}d)`, align: 'right' },
    { key: 'daysOfCover', label: 'Days Cover',  align: 'right',
      render: r => r.daysOfCover == null ? <span className="text-ink-dim">—</span>
        : <span className={r.daysOfCover < 14 ? 'text-danger font-semibold' : r.daysOfCover > 120 ? 'text-warning' : ''}>{r.daysOfCover}d</span>
    },
    { key: 'status', label: 'Status',
      render: r => <Badge label={STATUS_LABEL[r.status]||r.status} variant={STATUS_VARIANT[r.status]||'muted'} />
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Live Inventory Snapshot</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Real-time stock levels with sell-through velocity and cover days</div>
        </div>
        {rows && <button onClick={() => exportCSV('inventory-snapshot.csv', columns, rows)}
          className="flex-shrink-0 border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">Export CSV</button>}
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-3 sm:py-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Parameters</div>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Velocity Window (days)</label>
              <input type="number" min={7} value={days} onChange={e => setDays(Number(e.target.value))}
                className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-28 focus:outline-none focus:border-primary" />
            </div>
            <button onClick={run} disabled={loading}
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-5 py-2 h-9 transition-colors disabled:opacity-50">
              {loading ? '⟳ Running…' : '▶ Run Report'}
            </button>
          </div>
        </div>

        <StatusBar message={status.msg} type={status.type} />

        {meta && rows && (
          <>
            <div className="flex gap-3 flex-wrap">
              <StatCard label="Total SKUs"    value={meta.total} />
              <StatCard label="Out of Stock"  value={meta.outOfStock}  accent={meta.outOfStock  > 0 ? 'danger'  : 'success'} />
              <StatCard label="Low Stock"     value={meta.lowStock}    accent={meta.lowStock    > 0 ? 'warning' : 'success'} />
              <StatCard label="Overstock"     value={meta.overstock}   accent={meta.overstock   > 0 ? 'warning' : 'success'} />
              <StatCard label="No Movement"   value={meta.noMovement}  accent="muted" />
            </div>
            <div className="flex gap-2 flex-wrap">
              {['', 'out-of-stock', 'low-stock', 'overstock', 'no-movement', 'healthy'].map(s => (
                <button key={s} onClick={() => setFilter(s)}
                  className={`px-3 py-1 rounded font-mono text-xs border transition-colors ${filter === s ? 'bg-primary text-white border-primary' : 'bg-brand-surface border-brand-border text-ink-muted hover:border-primary hover:text-primary'}`}>
                  {s === '' ? 'All' : STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </>
        )}

        {filtered && <SortableTable columns={columns} rows={filtered} emptyMessage="No SKUs match this filter." />}
      </div>
    </div>
  )
}
