import { useState } from 'react'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'
import Badge         from '../../components/Badge'

const VELOCITY_VARIANT = { fast: 'success', medium: 'default', slow: 'warning', dead: 'danger' }

export default function Velocity() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [days,    setDays]    = useState(30)
  const [rows,    setRows]    = useState(null)
  const [meta,    setMeta]    = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const clientId = session?.isWarehouse ? selectedClientId : session?.clientId

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setRows(null)
    try {
      const url = buildReportURL('sku-velocity', { warehouseId, clientId, days })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setRows(res.rows || []); setMeta(res.meta || {})
      setStatus({ msg: `${(res.rows||[]).length} SKUs ranked`, type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }

  const columns = [
    { key: 'sku',           label: 'SKU',           render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',          label: 'Product',       render: r => <span className="text-ink-muted text-xs">{r.name||'—'}</span> },
    { key: 'currentStock',  label: 'In Stock',      align: 'right', render: r => <strong>{r.currentStock?.toLocaleString()}</strong> },
    { key: 'totalUnits',    label: 'Units Shipped', align: 'right' },
    { key: 'picksPerDay',   label: 'Picks / Day',   align: 'right',
      render: r => <span className={r.picksPerDay >= 5 ? 'text-success font-semibold' : r.picksPerDay === 0 ? 'text-ink-dim' : ''}>{r.picksPerDay}</span>
    },
    { key: 'ordersPerWeek', label: 'Orders / Wk',  align: 'right' },
    { key: 'unitsPerMonth', label: 'Units / Mo',   align: 'right' },
    { key: 'velocityClass', label: 'Class',
      render: r => <Badge label={r.velocityClass} variant={VELOCITY_VARIANT[r.velocityClass] || 'muted'} />
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">SKU Velocity</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Rank every SKU by movement speed — fast, medium, slow, or dead</div>
        </div>
        {rows && <button onClick={() => exportCSV('sku-velocity.csv', columns, rows)}
          className="flex-shrink-0 border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">Export CSV</button>}
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-3 sm:py-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Parameters</div>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Period (days)</label>
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
            <StatCard label="Fast Movers"   value={meta.fast}   accent="success" />
            <StatCard label="Medium"        value={meta.medium} accent="default" />
            <StatCard label="Slow Movers"   value={meta.slow}   accent="warning" />
            <StatCard label="Dead Stock"    value={meta.dead}   accent="danger" />
          </div>
        )}

        {rows && <SortableTable columns={columns} rows={rows} emptyMessage="No SKU data found." />}
      </div>
    </div>
  )
}
