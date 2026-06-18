import { useEffect, useState, useCallback, useRef } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession }        from '../context/SessionContext'
import { buildDashboardURL } from '../lib/api'
import { fetchReportSSE }    from '../lib/sse'
import StatCard      from '../components/StatCard'
import StatusBar     from '../components/StatusBar'
import SortableTable from '../components/SortableTable'
import Badge         from '../components/Badge'
import MiniCalendar  from '../components/MiniCalendar'
import MultiSelect   from '../components/MultiSelect'

const FONTS = { sans: 'Syne, sans-serif', mono: '"DM Mono", monospace' }

const DATE_PRESETS = [
  { id: 'today',     label: 'Today',       days: 0  },
  { id: 'yesterday', label: 'Yesterday',   days: -1 },
  { id: '7d',        label: 'Last 7 days', days: 7  },
  { id: '30d',       label: 'Last 30 days',days: 30 },
  { id: '90d',       label: 'Last 90 days',days: 90 },
]

function presetDates(preset) {
  const today = new Date()
  const fmt   = d => d.toISOString().split('T')[0]
  if (preset.days === 0)  return { dateFrom: fmt(today), dateTo: fmt(today) }
  if (preset.days === -1) {
    const y = new Date(today); y.setDate(today.getDate() - 1)
    return { dateFrom: fmt(y), dateTo: fmt(y) }
  }
  const from = new Date(today); from.setDate(today.getDate() - preset.days)
  return { dateFrom: fmt(from), dateTo: fmt(today) }
}

// Mintsoft order statuses from GET /api/Order/Statuses — shown until DB-populated list loads
const MINTSOFT_STATUSES = [
  'New', 'Printed', 'Cancelled', 'Despatched', 'Invoiced', 'Invoice Failed',
  'Holding', 'Failed', 'On Back Order', 'Awaiting Confirmation', 'Awaiting Documentation',
  'Awaiting Payment', 'Query Raised', 'Pack and Hold', 'Awaiting Picking',
  'Picking Started', 'Picked', 'Fraud Risk', 'Picking Skipped', 'Packed',
  'Awaiting Replen', 'Processing', 'Rebinned',
]

// ── Standalone Orders-by-Client panel (has its own date + status filters + fetch) ──
function ClientVolumePanel({ warehouseId }) {
  const [preset,           setPreset]   = useState('30d')
  const [statuses,         setStatuses] = useState(new Set())
  const [statusOptions,    setStatusOptions] = useState(MINTSOFT_STATUSES)
  const [rows,             setRows]     = useState(null)
  const [loading,          setLoading]  = useState(false)
  const [view,             setView]     = useState('chart')

  // Fetch real statuses from DB; fall back to hardcoded list if empty
  useEffect(() => {
    if (!warehouseId) return
    fetch('/api/orders/statuses')
      .then(r => r.json())
      .then(d => { if (d.statuses?.length) setStatusOptions(d.statuses) })
      .catch(() => {})
  }, [warehouseId])

  const load = useCallback(async (p, s) => {
    if (!warehouseId) return
    setLoading(true)
    try {
      const { dateFrom, dateTo } = presetDates(DATE_PRESETS.find(d => d.id === p))
      const params = new URLSearchParams({ warehouseId, dateFrom, dateTo })
      if (s.size > 0) params.set('statuses', [...s].join(','))
      const res  = await fetch(`/api/orders/by-client?${params}`)
      const data = await res.json()
      setRows(data.rows || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [warehouseId])

  useEffect(() => { load(preset, statuses) }, [warehouseId])

  const apply = (newPreset, newStatuses) => {
    setPreset(newPreset)
    setStatuses(newStatuses)
    load(newPreset, newStatuses)
  }

  const top12       = (rows || []).slice(0, 12)
  const total       = (rows || []).reduce((s, r) => s + r.order_count, 0)
  const presetLabel = DATE_PRESETS.find(d => d.id === preset)?.label || ''
  const statusNote  = statuses.size === 0 ? 'All statuses'
                    : statuses.size === 1   ? [...statuses][0]
                    : `${statuses.size} statuses`

  const chartOpts = {
    chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 400 } },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '55%' } },
    colors: ['#2D4270'],
    legend: { show: false },
    xaxis: {
      categories: top12.map(r => r.client_name),
      axisBorder: { show: false }, axisTicks: { show: false },
      labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' } }
    },
    yaxis: { labels: { style: { colors: '#1a1c2e', fontFamily: FONTS.sans, fontSize: '12px', fontWeight: 600 } } },
    grid: { borderColor: '#d8dbe8', strokeDashArray: 4, yaxis: { lines: { show: false } } },
    dataLabels: { enabled: false },
    tooltip: { theme: 'light', style: { fontFamily: FONTS.mono, fontSize: '12px' } },
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3 flex-shrink-0">
        {/* Date presets */}
        <div className="flex gap-1 flex-wrap">
          {DATE_PRESETS.map(p => (
            <button key={p.id} onClick={() => apply(p.id, statuses)}
              className={`font-mono text-[10px] px-2 py-0.5 rounded border transition-colors ${
                preset === p.id
                  ? 'bg-primary text-white border-primary'
                  : 'border-brand-border text-ink-muted hover:border-primary hover:text-primary bg-transparent'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        {/* Status filter — always shown; uses DB statuses when available, fallback list otherwise */}
        <MultiSelect
          label="All statuses"
          options={statusOptions.map(s => ({ value: s, label: s }))}
          value={statuses}
          onChange={s => apply(preset, s)}
        />
        {/* Chart / table toggle */}
        <button onClick={() => setView(v => v === 'chart' ? 'table' : 'chart')}
          className="ml-auto font-mono text-[10px] text-ink-muted hover:text-primary border border-brand-border hover:border-primary rounded px-2 py-1 transition-colors">
          {view === 'chart' ? '⊞ Table' : '📊 Chart'}
        </button>
      </div>

      {/* Summary */}
      {rows !== null && !loading && (
        <div className="font-mono text-[10px] text-ink-muted mb-2 flex-shrink-0">
          {total.toLocaleString()} orders · {presetLabel} · {statusNote}
        </div>
      )}

      {/* Content */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-xs text-ink-muted">Loading…</span>
        </div>
      )}

      {!loading && rows !== null && view === 'chart' && (
        top12.length > 0
          ? <ReactApexChart type="bar"
              series={[{ name: 'Orders', data: top12.map(r => r.order_count) }]}
              options={chartOpts}
              height={Math.min(Math.max(180, top12.length * 38), 360)} />
          : <div className="flex-1 flex items-center justify-center text-ink-muted font-mono text-sm">No orders found</div>
      )}

      {!loading && rows !== null && view === 'table' && (
        <SortableTable
          columns={[
            { key: 'client_name',  label: 'Client' },
            { key: 'order_count',  label: 'Orders', align: 'right', render: r => <strong>{r.order_count.toLocaleString()}</strong> },
          ]}
          rows={rows}
          emptyMessage="No orders found."
          fillHeight
        />
      )}
    </div>
  )
}

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
function Panel({ id, title, badge, viewMode, onToggleView, onDragStart, onDragEnd, onDragOver, onDrop, isDragOver, children, isTable, noToggle }) {
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
        {!noToggle && (
          <button
            onClick={onToggleView}
            className="font-mono text-[10px] text-ink-muted hover:text-primary border border-brand-border hover:border-primary rounded px-2 py-1 transition-colors"
          >
            {viewMode === 'table' ? '📊 Chart' : '⊞ Table'}
          </button>
        )}
      </div>

      {/* Content — flex-col when showing a table so fillHeight SortableTable can grow into the space;
           overflow-auto when showing a chart so the chart SVG can scroll if it exceeds panel height */}
      <div className={`flex-1 px-3 sm:px-5 pb-2 min-h-0 ${isTable ? 'flex flex-col overflow-hidden' : 'overflow-auto'}`}>
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

// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_ORDER = ['client-volume', 'mini-calendar', 'weekly-trend', 'client-health', 'stockout-alerts', 'monthly-revenue']
const INITIAL_VIEWS = {
  'client-volume':   'chart',
  'monthly-revenue': 'chart',
  'weekly-trend':    'chart',
  'client-health':   'table',
  'stockout-alerts': 'table',
  'mini-calendar':   'default',
}

export default function WarehouseDashboard() {
  const { session, warehouseId, selectedClientId } = useSession()
  const [data,           setData]         = useState(null)
  const [cachedAt,       setCachedAt]     = useState(null)
  const [status,         setStatus]       = useState({ msg: '', type: null })
  const [loading,        setLoading]      = useState(false)
  const [panelOrder,     setPanelOrder]   = useState(INITIAL_ORDER)
  const [panelViews,     setPanelViews]   = useState(INITIAL_VIEWS)
  const [dragSource,     setDragSource]   = useState(null)
  const [dragOver,       setDragOver]     = useState(null)

  // Top-level dashboard filters (warehouse-wide view only)
  const [selectedClients, setSelectedClients] = useState(new Set())  // Set of Mintsoft client ID strings; empty = all
  const [selectedStatuses, setSelectedStatuses] = useState(new Set()) // Set of status strings; empty = all
  const [availableStatuses, setAvailableStatuses] = useState([])

  // Fetch distinct order statuses once per warehouse
  useEffect(() => {
    if (!warehouseId || selectedClientId) return
    fetch('/api/orders/statuses')
      .then(r => r.json())
      .then(d => setAvailableStatuses(d.statuses || []))
      .catch(() => {})
  }, [warehouseId, selectedClientId])

  useEffect(() => { if (warehouseId) load(false) }, [warehouseId, selectedClientId])

  // Re-fetch when status filter changes (status filtering is server-side)
  useEffect(() => {
    if (warehouseId && !selectedClientId) load(false)
  }, [selectedStatuses])

  async function load(refresh = false) {
    setLoading(true)
    if (refresh) setStatus({ msg: 'Refreshing…', type: 'loading' })
    else         setStatus({ msg: 'Loading dashboard…', type: 'loading' })
    try {
      const statuses = [...selectedStatuses]
      const url    = buildDashboardURL({ warehouseId, clientId: selectedClientId, statuses, refresh })
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

  const toggleView = (id) => setPanelViews(v => ({ ...v, [id]: v[id] === 'table' ? 'chart' : 'table' }))

  const k           = data?.kpis || {}
  const ordersDelta = pct(k.totalOrders30, k.prevOrders)
  const allClients  = data?.clientBreakdown || []

  // Apply multi-client filter client-side (selectedClients is a Set of mintsoft ID strings)
  const clientList  = selectedClients.size === 0
    ? allClients
    : allClients.filter(c => selectedClients.has(String(c.id)))

  // ── Panel content renderers ───────────────────────────────────────────────

  // ClientVolumePanel manages its own state — defined above WarehouseDashboard

  function renderMonthlyRevenue(viewMode) {
    const allRevenue = data?.monthlyRevenue || []
    const filtered   = selectedClients.size === 0 ? allRevenue : allRevenue.filter(r => selectedClients.has(String(r.id)))
    const fmtGBP     = v => `£${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

    if (viewMode === 'chart') {
      if (!filtered.length) return <EmptyState message="No revenue data available. Run a sync to load invoice data." />
      const stackOpts = {
        chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, stacked: true, animations: { speed: 400 } },
        plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '60%' } },
        colors: ['#2D4270', '#c9a24b', '#16a34a', '#6b7280'],
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
        colors: ['#2D4270'],
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
    const filtered = clientList

    if (viewMode === 'chart') {
      const opts = {
        chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { speed: 400 } },
        plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '55%', distributed: true } },
        colors: filtered.map(c => c.status === 'critical' ? '#e03355' : c.status === 'attention' ? '#c9a24b' : '#16a34a'),
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
    const allAlerts = data?.stockAlerts || []
    const filtered  = selectedClients.size === 0 ? allAlerts : allAlerts.filter(a => selectedClients.has(String(a.clientId)))

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
    'client-volume':   { title: '▸ Orders by Client', noToggle: true, render: () => <ClientVolumePanel warehouseId={warehouseId} availableStatuses={availableStatuses} /> },
    'monthly-revenue': { title: data?.revenueSource === 'confirmed' ? '▸ Revenue (Last Invoice)' : '▸ Monthly Revenue (MTD)', render: renderMonthlyRevenue },
    'weekly-trend':    { title: '▸ Weekly Order Volume',                                                        render: renderWeeklyTrend    },
    'client-health':   { title: '▸ Client Health',                                                             render: renderClientHealth   },
    'stockout-alerts': {
      title: '▸ Stockout Alerts',
      badge: (data?.stockAlerts?.length || 0) > 0 ? <Badge label={`${data?.stockAlerts?.length} SKUs`} variant="danger" /> : null,
      render: renderStockoutAlerts,
    },
    'mini-calendar':   { title: '▸ Calendar', noToggle: true, render: () => <MiniCalendar /> },
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

  // ── Client-specific view (warehouse user drilled into a single client) ────
  if (selectedClientId) {
    const selectedClient = session?.clients?.find(c => String(c.ID || c.id) === selectedClientId)
    const clientName = selectedClient?.Name || selectedClient?.name || selectedClientId
    const ck  = data?.kpis       || {}
    const sh  = data?.stockHealth || {}
    const ordersDeltaC = pct(ck.orders30, ck.ordersPrev)
    const unitsDeltaC  = pct(ck.units30,  ck.unitsPrev)
    const HEALTH_COLORS = ['#16a34a', '#e03355', '#c9a24b', '#9ca3af', '#b91c1c']
    const HEALTH_LABELS = ['Healthy', 'Low Stock', 'Overstock', 'Dead Stock', 'Out of Stock']
    const salesTrendC = data?.salesTrend || []
    const lineOptsC = {
      chart: { type: 'area', background: 'transparent', toolbar: { show: false }, zoom: { enabled: false }, animations: { speed: 600 } },
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.2, opacityTo: 0.02 } },
      colors: ['#2D4270'],
      xaxis: { type: 'datetime', categories: salesTrendC.map(d => d.date), axisBorder: { show: false }, axisTicks: { show: false },
        labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' } } },
      yaxis: { labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' } } },
      grid: { borderColor: '#d8dbe8', strokeDashArray: 4 },
      dataLabels: { enabled: false }, markers: { size: 0 },
      tooltip: { x: { format: 'dd MMM' }, theme: 'light', style: { fontFamily: FONTS.mono, fontSize: '12px' } },
    }
    const donutSeriesC = [sh.healthy||0, sh.lowStock||0, sh.overstock||0, sh.deadStock||0, sh.outOfStock||0]
    const donutOptsC = {
      chart: { type: 'donut', background: 'transparent', animations: { speed: 500 } },
      colors: HEALTH_COLORS, labels: HEALTH_LABELS,
      plotOptions: { pie: { donut: { size: '68%', labels: { show: true,
        total: { show: true, label: 'Total SKUs', style: { fontFamily: FONTS.mono, fontSize: '11px', color: '#6b7280' },
          formatter: w => w.globals.seriesTotals.reduce((a, b) => a + b, 0) } } } } },
      legend: { position: 'bottom', fontFamily: FONTS.mono, fontSize: '11px', markers: { width: 8, height: 8, radius: 4 } },
      dataLabels: { enabled: false },
      tooltip: { theme: 'light', style: { fontFamily: FONTS.mono } },
    }
    const topProductCols = [
      { key: 'sku',          label: 'SKU',        render: r => <span className="font-mono text-xs">{r.sku}</span> },
      { key: 'name',         label: 'Product',    render: r => <span className="text-ink-muted truncate max-w-[180px] block text-xs">{r.name || '—'}</span> },
      { key: 'sold30',       label: 'Sold (30d)', align: 'right', render: r => <strong>{r.sold30?.toLocaleString()}</strong> },
      { key: 'currentStock', label: 'In Stock',   align: 'right' },
      { key: 'coverDays',    label: 'Cover',      align: 'right',
        render: r => { const v = r.coverDays; if (v == null) return <span className="text-ink-dim">—</span>
          return <span className={`font-semibold ${v < 14 ? 'text-danger' : v > 90 ? 'text-warning' : 'text-success'}`}>{v}d</span> } },
    ]
    const reorderCols = [
      { key: 'sku',           label: 'SKU',          render: r => <span className="font-mono text-xs">{r.sku}</span> },
      { key: 'name',          label: 'Product',      render: r => <span className="text-ink-muted text-xs">{r.name || '—'}</span> },
      { key: 'currentStock',  label: 'Stock',        align: 'right' },
      { key: 'coverDays',     label: 'Cover',        align: 'right',
        render: r => r.coverDays != null ? <span className="text-danger font-semibold">{r.coverDays}d</span>
          : <span className="font-mono text-[10px] bg-danger/10 text-danger px-1.5 rounded font-bold">OUT</span> },
      { key: 'suggestedOrder', label: 'Suggest Order', align: 'right',
        render: r => <strong className="text-primary">{r.suggestedOrder?.toLocaleString()}</strong> },
    ]
    return (
      <div className="flex-1 overflow-y-auto">
        <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
          <div>
            <div className="font-sans font-bold text-[15px] text-ink">{clientName} — Dashboard</div>
            <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
              {cachedAt ? <span>Data from <span className="text-primary">{timeAgo(cachedAt)}</span></span> : 'Inventory overview — last 30 days'}
            </div>
          </div>
          <button onClick={() => load(true)} disabled={loading}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-3 sm:px-4 py-2 transition-colors disabled:opacity-50 flex-shrink-0">
            {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
        </header>
        <div className="p-4 sm:p-7 space-y-6">
          <StatusBar message={status.msg} type={status.type} />
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Orders (30d)"       value={ck.orders30?.toLocaleString()} delta={ordersDeltaC} loading={loading && !data} />
            <StatCard label="Units Sold (30d)"   value={ck.units30?.toLocaleString()}  delta={unitsDeltaC}  loading={loading && !data} accent="primary" />
            <StatCard label="Low / Out of Stock" value={ck.lowStockCount} loading={loading && !data} accent={ck.lowStockCount > 0 ? 'danger' : 'success'} />
            <StatCard label="Avg Stock Cover"    value={ck.avgCoverDays != null ? `${ck.avgCoverDays} days` : '—'} loading={loading && !data}
              accent={ck.avgCoverDays < 21 ? 'danger' : ck.avgCoverDays > 60 ? 'warning' : 'success'} />
            <StatCard label="Total SKUs"         value={ck.totalSkus?.toLocaleString()} loading={loading && !data} />
          </div>
          {data && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
              <div className="xl:col-span-2 bg-brand-surface border border-brand-border rounded-lg p-5">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-4">▸ Units Dispatched — Last 30 Days</div>
                {salesTrendC.length > 0
                  ? <ReactApexChart type="area" series={[{ name: 'Units Sold', data: salesTrendC.map(d => d.units) }]} options={lineOptsC} height={240} />
                  : <div className="text-center py-10 text-ink-muted font-mono text-sm">No sales data for this period.</div>}
              </div>
              <div className="bg-brand-surface border border-brand-border rounded-lg p-5 flex flex-col">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-4">▸ Stock Health</div>
                {donutSeriesC.some(v => v > 0)
                  ? <ReactApexChart type="donut" series={donutSeriesC} options={donutOptsC} height={260} />
                  : <div className="flex-1 flex items-center justify-center text-ink-muted font-mono text-sm">No stock data</div>}
              </div>
            </div>
          )}
          {data && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-4">▸ Top 10 Products</div>
                <SortableTable columns={topProductCols} rows={data?.topProducts || []} emptyMessage="No sales data found." />
              </div>
              <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="font-mono text-[9px] text-primary uppercase tracking-widest">▸ Reorder Alerts</div>
                  {(data?.reorderList?.length || 0) > 0 && (
                    <span className="font-mono text-[9px] bg-danger/10 text-danger px-2 py-0.5 rounded font-bold">{data.reorderList.length} SKUs need ordering</span>
                  )}
                </div>
                <SortableTable columns={reorderCols} rows={data?.reorderList || []} emptyMessage="No reorder alerts — stock levels look healthy!" />
              </div>
            </div>
          )}
          {loading && !data && (
            <div className="space-y-4">
              {[1, 2].map(i => <div key={i} className="bg-brand-surface border border-brand-border rounded-lg p-5 h-64 animate-pulse" />)}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Topbar */}
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Warehouse Dashboard</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            {cachedAt
              ? <span>Data from <span className="text-primary">{timeAgo(cachedAt)}</span> · Drag panels to reorder · drag edge to resize</span>
              : 'Drag panels to reorder · drag bottom edge to resize · toggle chart/table view'
            }
          </div>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-3 sm:px-4 py-2 transition-colors disabled:opacity-50 flex-shrink-0">
          {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
        </button>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
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

        {/* Top-level filters — client multi-select + status */}
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[9px] text-ink-muted uppercase tracking-widest">Filter:</span>
            <MultiSelect
              label="All clients"
              options={allClients.map(c => ({ value: String(c.id), label: c.name }))}
              value={selectedClients}
              onChange={setSelectedClients}
            />
            {availableStatuses.length > 0 && (
              <MultiSelect
                label="All statuses"
                options={availableStatuses.map(s => ({ value: s, label: s }))}
                value={selectedStatuses}
                onChange={setSelectedStatuses}
              />
            )}
            {(selectedClients.size > 0 || selectedStatuses.size > 0) && (
              <button
                onClick={() => { setSelectedClients(new Set()); setSelectedStatuses(new Set()) }}
                className="font-mono text-[10px] text-ink-muted hover:text-danger transition-colors"
              >
                ✕ Clear all
              </button>
            )}
          </div>
        )}

        {/* Draggable panels grid */}
        {data && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {panelOrder.map(id => {
              const def      = PANELS[id]
              const viewMode = panelViews[id]
              return (
                <Panel
                  key={id}
                  id={id}
                  title={def.title}
                  badge={def.badge}
                  viewMode={viewMode}
                  isTable={viewMode === 'table'}
                  noToggle={def.noToggle}
                  onToggleView={() => toggleView(id)}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  isDragOver={dragOver === id}
                >
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
