import { useState } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'
import Badge         from '../../components/Badge'

const STATUS_VARIANT = { healthy: 'success', watchlist: 'warning', critical: 'danger' }
const FONTS = { mono: '"DM Mono", monospace', sans: 'Montserrat, sans-serif' }

function ScoreBar({ score }) {
  const color = score >= 70 ? '#16a34a' : score >= 40 ? '#c9a24b' : '#e03355'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-brand-surface2 rounded-full overflow-hidden">
        <div style={{ width: `${score}%`, backgroundColor: color }} className="h-full rounded-full transition-all" />
      </div>
      <span className="font-mono text-xs font-bold" style={{ color }}>{score}</span>
    </div>
  )
}

export default function HealthScore() {
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
      const url = buildReportURL('inventory-health-score', { warehouseId, clientId, days })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setRows(res.rows || []); setMeta(res.meta || {})
      setStatus({ msg: `${(res.rows||[]).length} SKUs scored`, type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }

  const donutOpts = meta ? {
    chart: { type: 'donut', background: 'transparent', animations: { speed: 400 } },
    colors: ['#16a34a', '#c9a24b', '#e03355'],
    labels: ['Healthy', 'Watchlist', 'Critical'],
    plotOptions: { pie: { donut: { size: '65%' } } },
    legend: { position: 'bottom', fontFamily: FONTS.mono, fontSize: '11px' },
    dataLabels: { enabled: false },
    tooltip: { theme: 'light', style: { fontFamily: FONTS.mono } },
  } : null

  const columns = [
    { key: 'sku',          label: 'SKU',         render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',         label: 'Product',     render: r => <span className="text-ink-muted text-xs">{r.name||'—'}</span> },
    { key: 'stock',        label: 'In Stock',    align: 'right', render: r => <strong>{r.stock?.toLocaleString()}</strong> },
    { key: 'daysOfCover',  label: 'Days Cover',  align: 'right',
      render: r => r.daysOfCover == null ? <span className="text-ink-dim">—</span>
        : <span className={r.daysOfCover < 14 ? 'text-danger font-semibold' : r.daysOfCover > 120 ? 'text-warning' : ''}>{r.daysOfCover}d</span>
    },
    { key: 'sellThrough',  label: 'Sell-Through', align: 'right', render: r => <span>{r.sellThrough}%</span> },
    { key: 'score',        label: 'Health Score', render: r => <ScoreBar score={r.score} /> },
    { key: 'status',       label: 'Status',
      render: r => <Badge label={r.status} variant={STATUS_VARIANT[r.status]||'muted'} />
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Inventory Health Score</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Composite health score per SKU — stockout risk + overstock + velocity</div>
        </div>
        {rows && <button onClick={() => exportCSV('health-score.csv', columns, rows)}
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
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 flex gap-3 flex-wrap content-start">
              <StatCard label="Overall Score"  value={`${meta.avgScore}/100`} accent={meta.avgScore >= 70 ? 'success' : meta.avgScore >= 40 ? 'warning' : 'danger'} />
              <StatCard label="Healthy"        value={meta.healthy}   accent="success" />
              <StatCard label="Watchlist"      value={meta.watchlist} accent="warning" />
              <StatCard label="Critical"       value={meta.critical}  accent="danger" />
            </div>
            {donutOpts && (
              <div className="bg-brand-surface border border-brand-border rounded-lg p-4">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-2">▸ Health Mix</div>
                <ReactApexChart type="donut" series={[meta.healthy, meta.watchlist, meta.critical]} options={donutOpts} height={200} />
              </div>
            )}
          </div>
        )}

        {rows && <SortableTable columns={columns} rows={rows} emptyMessage="No inventory data found." />}
      </div>
    </div>
  )
}
