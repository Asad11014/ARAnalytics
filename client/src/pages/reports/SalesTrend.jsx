import { useState } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'
import Badge from '../../components/Badge'

const CHART_FONTS = { mono: '"DM Mono", monospace', sans: 'Montserrat, sans-serif' }
const TREND_COLOR = { growing: '#16a34a', declining: '#e03355', stable: '#6b7280', new: '#2D4270', stopped: '#9ca3af' }

export default function SalesTrend() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [days,    setDays]    = useState(30)
  const [result,  setResult]  = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)

  const clientId = session?.isWarehouse ? selectedClientId : session?.clientId

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setResult(null)
    try {
      const url = buildReportURL('sales-trend', { warehouseId, clientId, days })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setResult(res)
      setStatus({ msg: `${res.meta?.totalSkus || 0} SKUs analysed`, type: 'success' })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const m = result?.meta || {}

  // Donut chart — trend distribution
  const trendCounts = result ? [m.growing || 0, result.rows?.filter(r => r.trend === 'stable').length || 0,
    m.declining || 0, m.new || 0, result.rows?.filter(r => r.trend === 'stopped').length || 0] : []
  const donutOptions = {
    chart: { type: 'donut', background: 'transparent', animations: { speed: 400 } },
    colors: ['#16a34a', '#6b7280', '#e03355', '#2D4270', '#9ca3af'],
    labels: ['Growing', 'Stable', 'Declining', 'New', 'Stopped'],
    plotOptions: { pie: { donut: { size: '65%' } } },
    legend: { position: 'bottom', fontFamily: CHART_FONTS.mono, fontSize: '11px' },
    dataLabels: { enabled: false },
    tooltip: { theme: 'light', style: { fontFamily: CHART_FONTS.mono } },
  }

  const columns = [
    { key: 'sku',        label: 'SKU',         render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',       label: 'Product',     render: r => <span className="text-ink-muted text-xs">{r.name || '—'}</span> },
    { key: 'recentUnits',label: `Recent (${days}d)`, align: 'right', render: r => <strong>{r.recentUnits}</strong> },
    { key: 'priorUnits', label: `Prior (${days}d)`,  align: 'right' },
    { key: 'changePct',  label: 'Change %',    align: 'right',
      render: r => {
        if (r.changePct == null) return <span className="text-ink-dim">—</span>
        const col = r.changePct > 0 ? 'text-success' : r.changePct < 0 ? 'text-danger' : 'text-ink-muted'
        return <span className={`font-semibold ${col}`}>{r.changePct > 0 ? '+' : ''}{r.changePct}%</span>
      }
    },
    { key: 'trend', label: 'Trend',
      render: r => <Badge label={r.trend}
        variant={r.trend === 'growing' ? 'success' : r.trend === 'declining' ? 'danger' : r.trend === 'new' ? 'default' : 'muted'}
      />
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Sales Trend Report</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Compare recent vs prior period to spot momentum shifts</div>
        </div>
        {result && (
          <button onClick={() => exportCSV('sales-trend.csv', columns, result.rows || [])}
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
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Comparison Period (days)</label>
              <input type="number" min={1} value={days} onChange={e => setDays(Number(e.target.value))}
                className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-32 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
            </div>
            <button onClick={run} disabled={loading}
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-5 py-2 h-9 transition-colors disabled:opacity-50">
              {loading ? '⟳ Running…' : '▶ Run Report'}
            </button>
          </div>
          {m.recentPeriod && (
            <div className="mt-2 font-mono text-[10px] text-ink-muted">
              Recent: {m.recentPeriod} &nbsp;|&nbsp; Prior: {m.priorPeriod}
            </div>
          )}
        </div>

        <StatusBar message={status.msg} type={status.type} />

        {result && (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 flex gap-3 flex-wrap content-start">
                <StatCard label="Total SKUs"  value={m.totalSkus} />
                <StatCard label="Growing"     value={m.growing}  accent="success" />
                <StatCard label="Declining"   value={m.declining} accent="danger" />
                <StatCard label="New SKUs"    value={m.new}       accent="primary" />
              </div>
              <div className="bg-brand-surface border border-brand-border rounded-lg p-4">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Trend Mix</div>
                {trendCounts.some(v => v > 0) && (
                  <ReactApexChart type="donut" series={trendCounts} options={donutOptions} height={220} />
                )}
              </div>
            </div>

            <SortableTable columns={columns} rows={result.rows || []} emptyMessage="No SKU data found." />
          </>
        )}
      </div>
    </div>
  )
}
