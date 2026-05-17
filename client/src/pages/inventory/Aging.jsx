import { useState } from 'react'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'
import Badge         from '../../components/Badge'

const BUCKET_VARIANT = { '0–30d': 'success', '31–60d': 'default', '61–90d': 'warning', '90d+': 'danger' }

export default function Aging() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [days,    setDays]    = useState(90)
  const [rows,    setRows]    = useState(null)
  const [meta,    setMeta]    = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const clientId = session?.isWarehouse ? selectedClientId : session?.clientId

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setRows(null)
    try {
      const url = buildReportURL('inventory-aging', { warehouseId, clientId, days })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setRows(res.rows || []); setMeta(res.meta || {})
      setStatus({ msg: `${(res.rows||[]).length} SKUs analysed`, type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }

  const columns = [
    { key: 'sku',          label: 'SKU',        render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',         label: 'Product',    render: r => <span className="text-ink-muted text-xs">{r.name||'—'}</span> },
    { key: 'stock',        label: 'In Stock',   align: 'right', render: r => <strong>{r.stock?.toLocaleString()}</strong> },
    { key: 'daysSince',    label: 'Days Since Last Sale', align: 'right',
      render: r => r.daysSince == null
        ? <span className="text-ink-dim">No sales found</span>
        : <span className={r.daysSince > 90 ? 'text-danger font-semibold' : r.daysSince > 60 ? 'text-warning' : ''}>{r.daysSince}d</span>
    },
    { key: 'lastSaleDate', label: 'Last Sale',  render: r => <span className="font-mono text-xs text-ink-muted">{r.lastSaleDate||'—'}</span> },
    { key: 'bucket', label: 'Aging Band',
      render: r => <Badge label={r.bucket} variant={BUCKET_VARIANT[r.bucket] || 'muted'} />
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Inventory Aging</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Identify stock that hasn't moved — by days since last sale</div>
        </div>
        {rows && <button onClick={() => exportCSV('inventory-aging.csv', columns, rows)}
          className="flex-shrink-0 border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">Export CSV</button>}
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-3 sm:py-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Parameters</div>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Order History (days)</label>
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
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Active (0–30d)"   value={meta.active}  accent="success" />
            <StatCard label="Watch (31–60d)"   value={meta.watch}   accent="default" />
            <StatCard label="At Risk (61–90d)" value={meta.atRisk}  accent="warning" />
            <StatCard label="Dead (90d+)"      value={meta.dead}    accent="danger" />
          </div>
        )}

        {rows && <SortableTable columns={columns} rows={rows} emptyMessage="No stock found." />}
      </div>
    </div>
  )
}
