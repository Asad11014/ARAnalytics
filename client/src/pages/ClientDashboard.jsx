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

const CHART_FONTS = { sans: 'Montserrat, sans-serif', mono: '"DM Mono", monospace' }
const HEALTH_COLORS = ['#16a34a', '#e03355', '#c9a24b', '#9ca3af', '#b91c1c']
const HEALTH_LABELS = ['Healthy', 'Low Stock', 'Overstock', 'Dead Stock', 'Out of Stock']

function pct(a, b) {
  if (!b || b === 0) return null
  return Math.round(((a - b) / b) * 100)
}

const RANGES = [
  { label: '24 Hrs', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
]

// Headline summary card — PF light-blue background, white text.
function SummaryCard({ label, value, placeholder, redValue }) {
  return (
    <div className="flex-1 min-w-[150px] rounded-lg px-4 py-3" style={{ background: '#7BABDA' }}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-white/85">{label}</div>
      {placeholder
        ? <div className="font-sans font-semibold text-[13px] text-white/80 italic mt-1.5">In development</div>
        : <div className={`font-sans font-extrabold text-2xl mt-1 ${redValue ? '' : 'text-white'}`}
               style={redValue ? { color: '#c81e1e' } : undefined}>{value}</div>}
    </div>
  )
}

export default function ClientDashboard() {
  const { session, warehouseId } = useSession()
  const [data,    setData]    = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const [range,   setRange]   = useState(30)

  useEffect(() => {
    if (warehouseId) load(false, range)
  }, [warehouseId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load(refresh = false, days = range) {
    setLoading(true)
    setStatus({ msg: 'Loading dashboard…', type: 'loading' })
    try {
      const url    = buildDashboardURL({ warehouseId, clientId: session?.clientId, refresh, range: days })
      const result = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setData(result)
      setStatus({ msg: '', type: null })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  function selectRange(days) {
    if (days === range) return
    setRange(days)
    load(false, days)
  }

  const rangeLabel = RANGES.find(r => r.days === range)?.label || `${range} days`

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
    colors: ['#2D4270'],
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
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Your overview — {rangeLabel.toLowerCase()}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Date range filter */}
          <div className="flex gap-0.5 bg-brand-surface2 rounded p-0.5">
            {RANGES.map(r => (
              <button key={r.days} onClick={() => selectRange(r.days)} disabled={loading}
                className={`font-mono text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                  range === r.days ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink'
                }`}>
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-3 sm:px-4 py-2 transition-colors disabled:opacity-50"
          >
            {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-7 space-y-6">
        <StatusBar message={status.msg} type={status.type} />

        {/* Summary cards */}
        <div className="flex gap-3 flex-wrap">
          <SummaryCard label="Orders Shipped"          value={(data?.summary?.ordersShipped ?? 0).toLocaleString()} />
          <SummaryCard label="Units Shipped"           value={(data?.summary?.unitsShipped ?? 0).toLocaleString()} />
          <SummaryCard label="Orders Shipped On Time"  placeholder />
          <SummaryCard label="Goods In Items Received" value={(data?.summary?.goodsInReceived ?? 0).toLocaleString()} />
          <SummaryCard label="Low / Out of Stock SKUs" value={(data?.summary?.lowOutStock ?? 0).toLocaleString()} redValue />
        </div>

        {/* Charts row */}
        {data && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            {/* Sales trend */}
            <div className="xl:col-span-2 bg-brand-surface border border-brand-border rounded-lg p-5">
              <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-4">
                ▸ Units Dispatched — Last {rangeLabel}
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
