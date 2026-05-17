import { useState } from 'react'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'
import Badge from '../../components/Badge'

export default function DeadStock() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [days,      setDays]      = useState(90)
  const [threshold, setThreshold] = useState(1)
  const [rows,      setRows]      = useState(null)
  const [meta,      setMeta]      = useState(null)
  const [status,    setStatus]    = useState({ msg: '', type: null })
  const [loading,   setLoading]   = useState(false)

  const clientId = session?.isWarehouse ? selectedClientId : session?.clientId

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setRows(null)
    try {
      const url = buildReportURL('dead-stock', { warehouseId, clientId, days, threshold })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setRows(res.rows || [])
      setMeta(res.meta || {})
      setStatus({ msg: `${(res.rows || []).length} dead stock SKUs found`, type: 'success' })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { key: 'sku',      label: 'SKU',      render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',     label: 'Product',  render: r => <span className="text-ink-muted text-xs">{r.name || '—'}</span> },
    { key: 'stock',    label: 'Units in Stock', align: 'right', render: r => <strong>{r.stock?.toLocaleString()}</strong> },
    { key: 'totalSold',label: `Sold (${days}d)`, align: 'right' },
    { key: 'severity', label: 'Risk',
      render: r => <Badge label={r.severity} variant={r.severity === 'high' ? 'danger' : r.severity === 'medium' ? 'warning' : 'muted'} />
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Dead Stock Report</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Identify SKUs occupying warehouse space with no sales</div>
        </div>
        {rows && (
          <button onClick={() => exportCSV('dead-stock.csv', columns, rows)}
            className="border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">
            Export CSV
          </button>
        )}
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-3 sm:py-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Parameters</div>
          <div className="flex gap-3 items-end flex-wrap">
            {[
              { label: 'Lookback Period (days)', value: days, set: setDays, min: 7 },
              { label: 'Max Units Sold (dead = below)', value: threshold, set: setThreshold, min: 0 },
            ].map(f => (
              <div key={f.label} className="flex flex-col gap-1">
                <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">{f.label}</label>
                <input type="number" min={f.min} value={f.value}
                  onChange={e => f.set(Number(e.target.value))}
                  className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-32 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
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

        {meta && rows && (
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Dead Stock SKUs"    value={meta.total}      accent={meta.total > 0 ? 'danger' : 'success'} />
            <StatCard label="Total Trapped Units" value={meta.totalUnits?.toLocaleString()} accent="warning" />
          </div>
        )}

        {rows && <SortableTable columns={columns} rows={rows} emptyMessage="No dead stock found." />}
      </div>
    </div>
  )
}
