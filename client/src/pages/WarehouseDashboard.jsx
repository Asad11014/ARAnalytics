import { useEffect, useState, useCallback, useRef } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession }        from '../context/SessionContext'
import { buildDashboardURL } from '../lib/api'
import { fetchReportSSE }    from '../lib/sse'
import StatCard      from '../components/StatCard'
import StatusBar     from '../components/StatusBar'
import SortableTable from '../components/SortableTable'
import Badge         from '../components/Badge'

const FONTS = { sans: 'Syne, sans-serif', mono: '"DM Mono", monospace' }

function pct(a, b) {
  if (!b) return null
  return Math.round(((a - b) / b) * 100)
}

function timeAgo(isoString) {
  if (!isoString) return null
  const diffMs  = Date.now() - new Date(isoString).getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}h ${diffMin % 60}m ago`
}

// ── Draggable, resizable panel wrapper ────────────────────────────────────────
function Panel({ id, title, badge, viewMode, onToggleView, onDragStart, onDragEnd, onDragOver, onDrop, isDragOver, children, isTable }) {
  const [height, setHeight] = useState(440)
  const panelRef = useRef(null)

  const startResize = useCallback((e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelRef.current.offsetHeight
    const onMove = (ev) => setHeight(Math.max(240, startH + ev.clientY - startY))
    const onUp   = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div
      ref={panelRef}
      style={{ height }}
      className={`bg-brand-surface rounded-lg flex flex-col border-2 transition-colors duration-100 ${isDragOver ? 'border-primary shadow-card-hover' : 'border-brand-border'}`}
      onDragOver={e => { e.preventDefault(); onDragOver(id) }}
      onDrop={e => { e.preventDefault(); onDrop(id) }}
    >
      {/* Draggable header */}
      <div
        draggable
        onDragStart={() => onDragStart(id)}
        onDragEnd={onDragEnd}
        className="flex items-center justify-between px-5 pt-4 pb-2 cursor-grab active:cursor-grabbing flex-shrink-0 select-none"
      >
        <div className="flex items-center gap-2">
          <span className="text-ink-dim text-xs tracking-widest mr-0.5">⠿⠿</span>
          <span className="font-mono text-[9px] text-primary uppercase tracking-widest">{title}</span>
          {badge}
        </div>
        <button
          onClick={onToggleView}
          className="font-mono text-[10px] text-ink-muted hover:text-primary border border-brand-border hover:border-primary rounded px-2 py-1 transition-colors"
        >
          {viewMode === 'table' ? '📊 Chart' : '⊞ Table'}
        </button>
      </div>

      {/* Content — flex-col when showing a table so fillHeight SortableTable can grow into the space;
           overflow-auto when showing a chart so the chart SVG can scroll if it exceeds panel height */}
      <div className={`flex-1 px-5 pb-2 min-h-0 ${isTable ? 'flex flex-col overflow-hidden' : 'overflow-auto'}`}>
        {children}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="h-3 flex-shrink-0 flex items-center justify-center cursor-ns-resize select-none"
        title="Drag to resize panel"
      >
        <div className="w-8 h-0.5 rounded-full bg-brand-border hover:bg-primary transition-colors" />
      </div>
    </div>
  )
}

// ── Client filter dropdown ────────────────────────────────────────────────────
function ClientFilter({ clients, value, onChange }) {
  if (!clients.length) return null
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="font-mono text-[9px] text-ink-muted uppercase tracking-wide">Filter:</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-brand-bg border border-brand-border rounded text-ink font-mono text-[11px] px-2 py-1 focus:outline-none focus:border-primary"
      >
        <option value="">All clients</option>
        {clients.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {value && (
        <button onClick={() => onChange('')} className="font-mono text-[10px] text-ink-muted hover:text-danger transition-colors">✕ Clear</button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_ORDER = ['client-volume', 'monthly-revenue', 'weekly-trend', 'client-health', 'stockout-alerts']
const INITIAL_VIEWS = {
  'client-volume':   'chart',
  'monthly-revenue': 'chart',
  'weekly-trend':    'chart',
  'client-health':   'table',
  'stockout-alerts': 'table',
}

export default function WarehouseDashboard() {
  const { session, warehouseId, selectedClientId } = useSession()
  const [data,       setData]       = useState(null)
  const [cachedAt,   setCachedAt]   = useState(null)
  const [status,     setStatus]     = useState({ msg: '', type: null })
  const [loading,    setLoading]    = useState(false)
  const [panelOrder, setPanelOrder] = useState(INITIAL_ORDER)
  const [panelViews, setPanelViews] = useState(INITIAL_VIEWS)
  const [dragSource, setDragSource] = useState(null)
  const [dragOver,   setDragOver]   = useState(null)
  const [filters,    setFilters]    = useState({})

  useEffect(() => { if (warehouseId) load(false) }, [warehouseId, selectedClientId])

  async function load(refresh = false) {
    setLoading(true)
    if (refresh) setStatus({ msg: 'Refreshing…', type: 'loading' })
    else         setStatus({ msg: 'Loading dashboard…', type: 'loading' })
    try {
      const url    = buildDashboardURL({ warehouseId, clientId: selectedClientId, refresh })
      const result = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setData(result)
      setCachedAt(result.cachedAt || null)
      setStatus({ msg: '', type: null })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Drag handlers
  const handleDragStart = (id)     => setDragSource(id)
  const handleDragEnd   = ()       => { setDragSource(null); setDragOver(null) }
  const handleDragOver  = (id)     => { if (id !== dragSource) setDragOver(id) }
  const handleDrop      = (target) => {
    if (!dragSource || dragSource === target) { handleDragEnd(); return }
    setPanelOrder(prev => {
      const next = [...prev]
      const fi = next.indexOf(dragSource), ti = next.indexOf(target)
      next.splice(fi, 1)
      next.splice(ti, 0, dragSource)
      return next
    })
    handleDragEnd()
  }

  const toggleView = (id)      => setPanelViews(v => ({ ...v, [id]: v[id] === 'table' ? 'chart' : 'table' }))
  const setFilter  = (id, val) => setFilters(f => ({ ...f, [id]: val }))

  const k           = data?.kpis || {}
  const ordersDelta = pct(k.totalOrders30, k.prevOrders)
  const clientList  = data?.clientBreakdown || []

  // ── Panel content renderers ───────────────────────────────────────────────

  function renderClientVolume(viewMode) {
    const f        = filters['client-volume'] || ''
    const filtered = f ? clientList.filter(c => c.id === f) : clientList
    const top12    = filtered.slice(0, 12)

    if (viewMode === 'chart') {
      const opts = {
        chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 400 } },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '55%' } },
        colors: ['#1f22ac'],
        legend: { show: false },
        xaxis: {
          categories: top12.map(c => c.name),
          axisBorder: { show: false }, axisTicks: { show: false },
          labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' } }
        },
        yaxis: { labels: { style: { colors: '#1a1c2e', fontFamily: FONTS.sans, fontSize: '12px', fontWeight: 600 } } },
        grid: { borderColor: '#d8dbe8', strokeDashArray: 4, yaxis: { lines: { show: false } } },
        dataLabels: { enabled: false },
        tooltip: { theme: 'light', style: { fontFamily: FONTS.mono, fontSize: '12px' } },
      }
      return top12.length > 0
        ? <ReactApexChart type="bar" series={[{ name: 'Orders', data: top12.map(c => c.orders30) }]} options={opts} height={Math.min(Math.max(180, top12.length * 38), 360)} />
        : <EmptyState message="No order data" />
    }

    const cols = [
      { key: 'name',     label: 'Client' },
      { key: 'orders30', label: 'Orders (30d)', align: 'right', render: r => <strong>{r.orders30}</strong> },
      { key: 'skuCount', label: 'SKUs',         align: 'right' },
    ]
    return <SortableTable columns={cols} rows={filtered} emptyMessage="No clients." fillHeight />
  }

  function renderMonthlyRevenue(viewMode) {
    const rows     = data?.monthlyRevenue || []
    const f        = filters['monthly-revenue'] || ''
    const filtered = f ? rows.filter(r => r.id === f) : rows
    const fmtGBP   = v => `£${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    if (viewMode === 'chart') {
      if (!filtered.length) return <EmptyState message="No revenue data this month." />
      const stackOpts = {
        chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, stacked: true, animations: { speed: 400 } },
        plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '60%' } },
        colors: ['#1f22ac', '#c79a51', '#16a34a', '#6b7280'],
        legend: { position: 'bottom', fontFamily: FONTS.mono, fontSize: '11px' },
        xaxis: {
          categories: filtered.map(r => r.name),
          axisBorder: { show: false }, axisTicks: { show: false },
          labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' },
            formatter: v => `£${Number(v).toLocaleString()}` }
        },
        yaxis: { labels: { style: { colors: '#1a1c2e', fontFamily: FONTS.sans, fontSize: '12px', fontWeight: 600 } } },
        grid: { borderColor: '#d8dbe8', strokeDashArray: 4, yaxis: { lines: { show: false } } },
        dataLabels: { enabled: false },
        tooltip: {
          theme: 'light', style: { fontFamily: FONTS.mono, fontSize: '12px' },
          y: { formatter: v => fmtGBP(v) }
        },
      }
      return (
        <ReactApexChart type="bar"
          series={[
            { name: 'Picking',  data: filtered.map(r => r.picking) },
            { name: 'Postage',  data: filtered.map(r => r.postage) },
            { name: 'Storage',  data: filtered.map(r => r.storage) },
            { name: 'Other',    data: filtered.map(r => r.other)   },
          ]}
          options={stackOpts}
          height={Math.min(Math.max(200, filtered.length * 44 + 60), 360)}
        />
      )
    }

    const cols = [
      { key: 'name',    label: 'Client' },
      { key: 'picking', label: 'Picking',  align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.picking)}</span> },
      { key: 'postage', label: 'Postage',  align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.postage)}</span> },
      { key: 'storage', label: 'Storage',  align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.storage)}</span> },
      { key: 'other',   label: 'Other',    align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.other)}</span>   },
      { key: 'revenue', label: 'Total',    align: 'right',
        render: r => <span className="font-semibold text-gold">{fmtGBP(r.revenue)}</span>
      },
    ]
    return filtered.length > 0
      ? <SortableTable columns={cols} rows={filtered} emptyMessage="No activity this month." fillHeight />
      : <EmptyState message="No client activity this month." />
  }

  function renderWeeklyTrend(viewMode) {
    const trend = data?.weeklyTrend || []
    if (viewMode === 'chart') {
      const opts = {
        chart: { type: 'area', background: 'transparent', toolbar: { show: false }, zoom: { enabled: false }, animations: { speed: 400 } },
        stroke: { curve: 'smooth', width: 2 },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.18, opacityTo: 0.02 } },
        colors: ['#1f22ac'],
        xaxis: { categories: trend.map(w => w.week), axisBorder: { show: false }, axisTicks: { show: false },
          labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '10px' }, rotate: -30 } },
        yaxis: { labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' } } },
        grid: { borderColor: '#d8dbe8', strokeDashArray: 4 },
        dataLabels: { enabled: false }, markers: { size: 0 },
        tooltip: { theme: 'light', style: { fontFamily: FONTS.mono, fontSize: '12px' } },
      }
      return trend.length > 0
        ? <ReactApexChart type="area" series={[{ name: 'Orders', data: trend.map(w => w.orders) }]} options={opts} height={260} />
        : <EmptyState message="No trend data" />
    }
    const cols = [
      { key: 'week',   label: 'Week commencing' },
      { key: 'orders', label: 'Orders', align: 'right', render: r => <strong>{r.orders}</strong> },
    ]
    return <SortableTable columns={cols} rows={trend} emptyMessage="No data." fillHeight />
  }

  function renderClientHealth(viewMode) {
    const f        = filters['client-health'] || ''
    const filtered = f ? clientList.filter(c => c.id === f) : clientList

    if (viewMode === 'chart') {
      const opts = {
        chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 400 } },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '55%', distributed: true } },
        colors: filtered.map(c => c.status === 'critical' ? '#e03355' : c.status === 'attention' ? '#c79a51' : '#16a34a'),
        legend: { show: false },
        xaxis: {
          categories: filtered.map(c => c.name),
          axisBorder: { show: false }, axisTicks: { show: false },
          labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' } }
        },
        yaxis: { labels: { style: { colors: '#1a1c2e', fontFamily: FONTS.sans, fontSize: '12px', fontWeight: 600 } } },
        grid: { borderColor: '#d8dbe8', strokeDashArray: 4, yaxis: { lines: { show: false } } },
        dataLabels: { enabled: false },
        tooltip: { theme: 'light', style: { fontFamily: FONTS.mono, fontSize: '12px' } },
      }
      return filtered.length > 0
        ? <ReactApexChart type="bar" series={[{ name: 'Stockouts', data: filtered.map(c => c.stockoutCount) }]} options={opts} height={Math.min(Math.max(180, filtered.length * 38), 360)} />
        : <EmptyState message="No data" />
    }

    const cols = [
      { key: 'name',          label: 'Client' },
      { key: 'orders30',      label: 'Orders (30d)', align: 'right' },
      { key: 'skuCount',      label: 'SKUs',         align: 'right' },
      { key: 'stockoutCount', label: 'Stockouts',    align: 'right',
        render: r => <span className={r.stockoutCount > 0 ? 'text-danger font-semibold' : ''}>{r.stockoutCount}</span> },
      { key: 'status', label: 'Status', render: r => <Badge label={r.status} variant={r.status} /> },
    ]
    return <SortableTable columns={cols} rows={filtered} emptyMessage="No client data." fillHeight />
  }

  function renderStockoutAlerts(viewMode) {
    const alerts   = data?.stockAlerts || []
    const f        = filters['stockout-alerts'] || ''
    const filtered = f ? alerts.filter(a => a.clientId === f) : alerts

    if (viewMode === 'chart') {
      const byClient = {}
      for (const a of filtered) byClient[a.clientName] = (byClient[a.clientName] || 0) + 1
      const chartData = Object.entries(byClient).sort(([, a], [, b]) => b - a)
      const opts = {
        chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 400 } },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '55%' } },
        colors: ['#e03355'],
        xaxis: {
          categories: chartData.map(([name]) => name),
          axisBorder: { show: false }, axisTicks: { show: false },
          labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' } }
        },
        yaxis: { labels: { style: { colors: '#1a1c2e', fontFamily: FONTS.sans, fontSize: '12px', fontWeight: 600 } } },
        grid: { borderColor: '#d8dbe8', strokeDashArray: 4, yaxis: { lines: { show: false } } },
        dataLabels: { enabled: true, style: { fontFamily: FONTS.mono, fontSize: '11px', colors: ['#fff'] } },
        tooltip: { theme: 'light', style: { fontFamily: FONTS.mono, fontSize: '12px' } },
      }
      return chartData.length > 0
        ? <ReactApexChart type="bar" series={[{ name: 'Stockouts', data: chartData.map(([, v]) => v) }]} options={opts} height={Math.min(Math.max(180, chartData.length * 42), 360)} />
        : <EmptyState message="No stockout alerts" />
    }

    const cols = [
      { key: 'clientName', label: 'Client',  render: r => <span className="font-semibold">{r.clientName}</span> },
      { key: 'sku',        label: 'SKU',     render: r => <span className="font-mono text-xs">{r.sku}</span> },
      { key: 'name',       label: 'Product', render: r => <span className="text-ink-muted text-xs">{r.name || '—'}</span> },
    ]
    return filtered.length > 0
      ? <SortableTable columns={cols} rows={filtered} emptyMessage="No stockout alerts." fillHeight />
      : <EmptyState message="No stockouts matching this filter." />
  }

  // ── Panel definitions ─────────────────────────────────────────────────────

  const PANELS = {
    'client-volume': {
      title: '▸ Orders by Client — 30 Days',
      badge: null,
      hasClientFilter: true,
      render: renderClientVolume,
    },
    'monthly-revenue': {
      title: '▸ Monthly Revenue (MTD)',
      badge: null,
      hasClientFilter: true,
      render: renderMonthlyRevenue,
    },
    'weekly-trend': {
      title: '▸ Weekly Order Volume',
      badge: null,
      hasClientFilter: false,
      render: renderWeeklyTrend,
    },
    'client-health': {
      title: '▸ Client Health',
      badge: null,
      hasClientFilter: true,
      render: renderClientHealth,
    },
    'stockout-alerts': {
      title: '▸ Stockout Alerts',
      badge: (data?.stockAlerts?.length || 0) > 0
        ? <Badge label={`${data?.stockAlerts?.length} SKUs`} variant="danger" />
        : null,
      hasClientFilter: true,
      render: renderStockoutAlerts,
    },
  }

  // ── No warehouse selected ─────────────────────────────────────────────────
  if (!warehouseId) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div>
          <div className="text-5xl mb-4">🏭</div>
          <div className="font-sans font-bold text-lg text-ink mb-2">Select a warehouse</div>
          <div className="font-mono text-sm text-ink-muted">Choose a warehouse from the sidebar to load your dashboard.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Topbar */}
      <header className="bg-brand-surface border-b border-brand-border px-7 h-[52px] flex items-center justify-between sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Warehouse Dashboard</div>
          <div className="font-mono text-[11px] text-ink-muted">
            {cachedAt
              ? <span>Data from <span className="text-primary">{timeAgo(cachedAt)}</span> · Drag panels to reorder · drag edge to resize</span>
              : 'Drag panels to reorder · drag bottom edge to resize · toggle chart/table view'
            }
          </div>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-4 py-2 transition-colors disabled:opacity-50">
          {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
        </button>
      </header>

      <div className="p-7 space-y-5">
        <StatusBar message={status.msg} type={status.type} />

        {/* KPI cards */}
        <div className="flex gap-3 flex-wrap">
          <StatCard label="Total Clients"   value={k.totalClients}                    loading={loading && !data} />
          <StatCard label="Active (30d)"    value={k.activeClients}                   loading={loading && !data} accent="primary" />
          <StatCard label="Orders (30d)"    value={k.totalOrders30?.toLocaleString()} delta={ordersDelta}         loading={loading && !data} />
          <StatCard label="Total SKUs"      value={k.totalSkus?.toLocaleString()}      loading={loading && !data} />
          <StatCard label="Stockout Alerts" value={k.totalAlerts}                      loading={loading && !data}
            accent={k.totalAlerts > 0 ? 'danger' : 'success'} />
        </div>

        {/* Draggable panels grid */}
        {data && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {panelOrder.map(id => {
              const def      = PANELS[id]
              const viewMode = panelViews[id]
              const filter   = filters[id] || ''
              return (
                <Panel
                  key={id}
                  id={id}
                  title={def.title}
                  badge={def.badge}
                  viewMode={viewMode}
                  isTable={viewMode === 'table'}
                  onToggleView={() => toggleView(id)}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  isDragOver={dragOver === id}
                >
                  {def.hasClientFilter && (
                    <ClientFilter
                      clients={clientList.map(c => ({ id: c.id, name: c.name }))}
                      value={filter}
                      onChange={val => setFilter(id, val)}
                    />
                  )}
                  {def.render(viewMode)}
                </Panel>
              )
            })}
          </div>
        )}

        {/* Skeleton while loading */}
        {loading && !data && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="bg-brand-surface border border-brand-border rounded-lg h-[440px] animate-pulse" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <div className="flex items-center justify-center h-32 text-ink-muted font-mono text-sm">
      {message}
    </div>
  )
}
