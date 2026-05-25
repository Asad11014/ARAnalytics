import { useEffect, useState } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession }      from '../context/SessionContext'
import { buildDashboardURL } from '../lib/api'
import { fetchReportSSE }    from '../lib/sse'
import StatCard      from '../components/StatCard'
import StatusBar     from '../components/StatusBar'
import SortableTable from '../components/SortableTable'
import Badge         from '../components/Badge'
import MiniCalendar  from '../components/MiniCalendar'

const CHART_FONTS = { sans: 'Syne, sans-serif', mono: '"DM Mono", monospace' }
const HEALTH_COLORS = ['#16a34a', '#e03355', '#c79a51', '#9ca3af', '#b91c1c']
const HEALTH_LABELS = ['Healthy', 'Low Stock', 'Overstock', 'Dead Stock', 'Out of Stock']

function pct(a, b) {
  if (!b || b === 0) return null
  return Math.round(((a - b) / b) * 100)
}

export default function ClientDashboard() {
  const { session, warehouseId } = useSession()
  const [data,    setData]    = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (warehouseId) load(false)
  }, [warehouseId])

  async function load(refresh = false) {
    setLoading(true)
    setStatus({ msg: 'Loading dashboard…', type: 'loading' })
    try {
      const url    = buildDashboardURL({ warehouseId, clientId: session?.clientId, refresh })
      const result = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setData(result)
      setStatus({ msg: '', type: null })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const k  = data?.kpis      || {}
  const sh = data?.stockHealth || {}

  const ordersDelta = pct(k.orders30, k.ordersPrev)
  const unitsDelta  = pct(k.units30,  k.unitsPrev)

  // Sales trend line chart
  const salesTrend = data?.salesTrend || []
  const lineOptions = {
    chart: { type: 'area', background: 'transparent', toolbar: { show: false }, zoom: { enabled: false }, animations: { speed: 600 } },
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.2, opacityTo: 0.02 } },
    colors: ['#1f22ac'],
    xaxis: {
      type: 'datetime',
      categories: salesTrend.map(d => d.date),
      axisBorder: { show: false }, axisTicks: { show: false },
      labels: { style: { colors: '#6b7280', fontFamily: CHART_FONTS.mono, fontSize: '11px' } }
    },
    yaxis: { labels: { style: { colors: '#6b7280', fontFamily: CHART_FONTS.mono, fontSize: '11px' } } },
    grid: { borderColor: '#d8dbe8', strokeDashArray: 4 },
    dataLabels: { enabled: false },
    markers: { size: 0 },
    tooltip: { x: { format: 'dd MMM' }, theme: 'light', style: { fontFamily: CHART_FONTS.mono, fontSize: '12px' } },
  }

  // Stock health donut
  const donutSeries  = [sh.healthy || 0, sh.lowStock || 0, sh.overstock || 0, sh.deadStock || 0, sh.outOfStock || 0]
  const donutOptions = {
    chart: { type: 'donut', background: 'transparent', animations: { speed: 500 } },
    colors:  HEALTH_COLORS,
    labels:  HEALTH_LABELS,
    plotOptions: {
      pie: {
        donut: {
          size: '68%',
          labels: {
            show: true,
            total: {
              show: true, label: 'Total SKUs',
              style: { fontFamily: CHART_FONTS.mono, fontSize: '11px', color: '#6b7280' },
              formatter: w => w.globals.seriesTotals.reduce((a, b) => a + b, 0)
            }
          }
        }
      }
    },
    legend: { position: 'bottom', fontFamily: CHART_FONTS.mono, fontSize: '11px', markers: { width: 8, height: 8, radius: 4 } },
    dataLabels: { enabled: false },
    tooltip: { theme: 'light', style: { fontFamily: CHART_FONTS.mono } },
  }

  // Top products table
  const topProductColumns = [
    { key: 'rank',         label: '#',          render: (_, i) => <span className="text-ink-muted">{i + 1}</span> },
    { key: 'sku',          label: 'SKU',        render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',         label: 'Product',    render: r => <span className="text-ink-muted truncate max-w-[180px] block text-xs">{r.name || '—'}</span> },
    { key: 'sold30',       label: 'Sold (30d)', align: 'right', render: r => <strong>{r.sold30?.toLocaleString()}</strong> },
    { key: 'currentStock', label: 'In Stock',   align: 'right' },
    { key: 'coverDays',    label: 'Cover',      align: 'right',
      render: r => {
        const v = r.coverDays
        if (v == null) return <span className="text-ink-dim">—</span>
        const col = v < 14 ? 'text-danger' : v > 90 ? 'text-warning' : 'text-success'
        return <span className={`font-semibold ${col}`}>{v}d</span>
      }
    },
  ]

  // Reorder alerts table
  const reorderColumns = [
    { key: 'sku',           label: 'SKU',          render: r => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name',          label: 'Product',      render: r => <span className="text-ink-muted text-xs truncate max-w-[160px] block">{r.name || '—'}</span> },
    { key: 'currentStock',  label: 'Stock',        align: 'right' },
    { key: 'coverDays',     label: 'Cover',        align: 'right',
      render: r => r.coverDays != null
        ? <span className="text-danger font-semibold">{r.coverDays}d</span>
        : <Badge label="OUT" variant="danger" dot={false} />
    },
    { key: 'suggestedOrder', label: 'Suggest Order', align: 'right',
      render: r => <strong className="text-primary">{r.suggestedOrder?.toLocaleString()}</strong>
    },
  ]

  if (!warehouseId) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div>
          <div className="text-5xl mb-4">📦</div>
          <div className="font-sans font-bold text-lg text-ink mb-2">Select a warehouse</div>
          <div className="font-mono text-sm text-ink-muted">Choose your warehouse from the sidebar to load your dashboard.</div>
        </div>
      </div>
    )
  }

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Topbar */}
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">
            {greeting}, {session?.username?.split('@')[0] || session?.username}!
          </div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Your inventory overview — last 30 days</div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-3 sm:px-4 py-2 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
        </button>
      </header>

      <div className="p-4 sm:p-7 space-y-6">
        <StatusBar message={status.msg} type={status.type} />

        {/* KPI cards */}
        <div className="flex gap-3 flex-wrap">
          <StatCard label="Orders (30d)"    value={k.orders30?.toLocaleString()}
                    delta={ordersDelta}     loading={loading && !data} />
          <StatCard label="Units Sold (30d)" value={k.units30?.toLocaleString()}
                    delta={unitsDelta}      loading={loading && !data} accent="primary" />
          <StatCard label="Low / Out of Stock" value={k.lowStockCount}
                    loading={loading && !data}
                    accent={k.lowStockCount > 0 ? 'danger' : 'success'} />
          <StatCard label="Avg Stock Cover"
                    value={k.avgCoverDays != null ? `${k.avgCoverDays} days` : '—'}
                    loading={loading && !data}
                    accent={k.avgCoverDays < 21 ? 'danger' : k.avgCoverDays > 60 ? 'warning' : 'success'} />
          <StatCard label="Total SKUs"      value={k.totalSkus?.toLocaleString()} loading={loading && !data} />
        </div>

        {/* Charts row */}
        {data && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            {/* Sales trend */}
            <div className="xl:col-span-2 bg-brand-surface border border-brand-border rounded-lg p-5">
              <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-4">
                ▸ Units Dispatched — Last 30 Days
              </div>
              {salesTrend.length > 0 ? (
                <ReactApexChart
                  type="area"
                  series={[{ name: 'Units Sold', data: salesTrend.map(d => d.units) }]}
                  options={lineOptions}
                  height={240}
                />
              ) : (
                <div className="text-center py-10 text-ink-muted font-mono text-sm">No sales data for this period.</div>
              )}
            </div>

            {/* Stock health donut */}
            <div className="bg-brand-surface border border-brand-border rounded-lg p-5 flex flex-col">
              <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-4">
                ▸ Stock Health
              </div>
              {donutSeries.some(v => v > 0) ? (
                <ReactApexChart
                  type="donut"
                  series={donutSeries}
                  options={donutOptions}
                  height={260}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-ink-muted font-mono text-sm">
                  No stock data
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mini calendar */}
        {data && <MiniCalendar />}

        {/* Tables row */}
        {data && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Top products */}
            <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
              <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-4">
                ▸ Top 10 Products
              </div>
              <SortableTable
                columns={topProductColumns}
                rows={(data?.topProducts || []).map((r, i) => ({ ...r, rank: i + 1 }))}
                emptyMessage="No sales data found."
              />
            </div>

            {/* Reorder alerts */}
            <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest">
                  ▸ Reorder Alerts
                </div>
                {(data?.reorderList?.length || 0) > 0 && (
                  <Badge label={`${data.reorderList.length} SKUs need ordering`} variant="danger" />
                )}
              </div>
              <SortableTable
                columns={reorderColumns}
                rows={data?.reorderList || []}
                emptyMessage="No reorder alerts — stock levels look healthy!"
              />
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div className="space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="bg-brand-surface border border-brand-border rounded-lg p-5 h-64 animate-pulse" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
