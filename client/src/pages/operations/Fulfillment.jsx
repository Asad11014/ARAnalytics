import { useState } from 'react'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'

export default function Fulfillment() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [days,    setDays]    = useState(30)
  const [slaDays, setSlaDays] = useState(2)
  const [rows,    setRows]    = useState(null)
  const [meta,    setMeta]    = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const clientId = session?.isWarehouse ? selectedClientId : session?.clientId

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setRows(null)
    try {
      const url = buildReportURL('fulfillment', { warehouseId, clientId, days, slaDays })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setRows(res.rows || []); setMeta(res.meta || {})
      setStatus({ msg: `${(res.rows||[]).length} clients analysed`, type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }

  const columns = [
    { key: 'clientName',  label: 'Client',         render: r => <span className="font-semibold">{r.clientName}</span> },
    { key: 'orders',      label: 'Orders',          align: 'right' },
    { key: 'despatched',  label: 'Despatched',      align: 'right' },
    { key: 'sameDayPct',  label: 'Same-Day %',      align: 'right',
      render: r => r.sameDayPct == null ? <span className="text-ink-dim">—</span>
        : <span className={r.sameDayPct >= 80 ? 'text-success font-semibold' : r.sameDayPct >= 50 ? 'text-warning' : 'text-danger'}>{r.sameDayPct}%</span>
    },
    { key: 'slaPct',      label: `SLA (≤${slaDays}d) %`, align: 'right',
      render: r => r.slaPct == null ? <span className="text-ink-dim">—</span>
        : <span className={r.slaPct >= 95 ? 'text-success font-semibold' : r.slaPct >= 80 ? 'text-warning' : 'text-danger font-semibold'}>{r.slaPct}%</span>
    },
    { key: 'avgDays',     label: 'Avg Days',        align: 'right',
      render: r => r.avgDays == null ? <span className="text-ink-dim">—</span> : <span>{r.avgDays}d</span>
    },
    { key: 'lateOrders',  label: 'Late Orders',     align: 'right',
      render: r => <span className={r.lateOrders > 0 ? 'text-danger font-semibold' : ''}>{r.lateOrders}</span>
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Fulfillment Performance</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Order-to-despatch times, SLA compliance, and same-day shipping rates</div>
        </div>
        {rows && <button onClick={() => exportCSV('fulfillment.csv', columns, rows)}
          className="flex-shrink-0 border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">Export CSV</button>}
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-3 sm:py-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Parameters</div>
          <div className="flex gap-3 items-end flex-wrap">
            {[
              { label: 'Period (days)', value: days, set: setDays, min: 7 },
              { label: 'SLA Target (days)', value: slaDays, set: setSlaDays, min: 1 },
            ].map(f => (
              <div key={f.label} className="flex flex-col gap-1">
                <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">{f.label}</label>
                <input type="number" min={f.min} value={f.value} onChange={e => f.set(Number(e.target.value))}
                  className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-28 focus:outline-none focus:border-primary" />
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
            <StatCard label="Total Orders"   value={meta.totalOrders?.toLocaleString()} />
            <StatCard label="Same-Day %"     value={`${meta.sameDayPct}%`} accent={meta.sameDayPct >= 50 ? 'success' : 'warning'} />
            <StatCard label={`SLA (≤${slaDays}d) %`} value={`${meta.slaPct}%`} accent={meta.slaPct >= 95 ? 'success' : meta.slaPct >= 80 ? 'warning' : 'danger'} />
            <StatCard label="Avg Fulfil Days" value={`${meta.avgFulfillDays}d`} />
            <StatCard label="Late Orders"    value={meta.lateOrders} accent={meta.lateOrders > 0 ? 'danger' : 'success'} />
          </div>
        )}

        {rows && <SortableTable columns={columns} rows={rows} emptyMessage="No order data found." />}
      </div>
    </div>
  )
}
