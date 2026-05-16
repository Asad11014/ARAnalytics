import { useState } from 'react'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'
import Badge from '../../components/Badge'

export default function Replenishment() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [days,         setDays]         = useState(30)
  const [coverageDays, setCoverageDays] = useState(60)
  const [leadTime,     setLeadTime]     = useState(14)
  const [rows,         setRows]         = useState(null)
  const [meta,         setMeta]         = useState(null)
  const [status,       setStatus]       = useState({ msg: '', type: null })
  const [loading,      setLoading]      = useState(false)

  const clientId = session?.isWarehouse ? selectedClientId : session?.clientId

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setRows(null)
    try {
      const url = buildReportURL('replenishment', { warehouseId, clientId, days, coverageDays, leadTime })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setRows(res.rows || [])
      setMeta(res.meta || {})
      setStatus({ msg: `${(res.rows || []).length} SKUs analysed`, type: 'success' })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { key: 'sku',       label: 'SKU',          render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',      label: 'Product',      render: r => <span className="text-ink-muted text-xs">{r.name || '—'}</span> },
    { key: 'stock',     label: 'Stock',        align: 'right' },
    { key: 'totalSold', label: `Sold (${days}d)`, align: 'right' },
    { key: 'dailyVel',  label: 'Daily Velocity', align: 'right',
      render: r => <span className="font-mono">{r.dailyVel}</span> },
    { key: 'daysLeft',  label: 'Days Left',    align: 'right',
      render: r => {
        if (r.daysLeft == null) return <span className="text-ink-dim">—</span>
        const col = r.daysLeft < 14 ? 'text-danger font-bold' : r.daysLeft < 30 ? 'text-warning' : 'text-success'
        return <span className={col}>{r.daysLeft}d</span>
      }
    },
    { key: 'orderQty',  label: 'Order Qty',    align: 'right',
      render: r => r.orderQty > 0
        ? <strong className="text-primary">{r.orderQty.toLocaleString()}</strong>
        : <span className="text-ink-dim">—</span>
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-7 h-[52px] flex items-center justify-between sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Replenishment Planner</div>
          <div className="font-mono text-[11px] text-ink-muted">Calculate how much of each SKU to order</div>
        </div>
        {rows && (
          <button
            onClick={() => exportCSV('replenishment.csv', columns, rows)}
            className="border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors"
          >
            Export CSV
          </button>
        )}
      </header>

      <div className="p-7 space-y-5">
        {/* Config panel */}
        <div className="bg-brand-surface border border-brand-border rounded-lg px-6 py-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Parameters</div>
          <div className="flex gap-3 items-end flex-wrap">
            {[
              { label: 'Velocity Window', value: days, set: setDays, min: 7 },
              { label: 'Coverage Target', value: coverageDays, set: setCoverageDays, min: 7 },
              { label: 'Lead Time (days)', value: leadTime, set: setLeadTime, min: 1 },
            ].map(f => (
              <div key={f.label} className="flex flex-col gap-1">
                <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">{f.label}</label>
                <input type="number" min={f.min} value={f.value}
                  onChange={e => f.set(Number(e.target.value))}
                  className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-28 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>
            ))}
            <button onClick={run} disabled={loading}
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-5 py-2 h-9 transition-colors disabled:opacity-50">
              {loading ? '⟳ Running…' : '▶ Run Report'}
            </button>
          </div>
        </div>

        <StatusBar message={status.msg} type={status.type} />

        {/* Stats */}
        {meta && rows && (
          <div className="flex gap-3 flex-wrap">
            <StatCard label="SKUs Analysed"   value={meta.total} />
            <StatCard label="Need Ordering"   value={meta.needsOrder} accent={meta.needsOrder > 0 ? 'danger' : 'success'} />
          </div>
        )}

        {rows && <SortableTable columns={columns} rows={rows} emptyMessage="No SKUs found for this selection." />}
      </div>
    </div>
  )
}
