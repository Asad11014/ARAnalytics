import { useState, useEffect, useMemo, useCallback } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession } from '../../context/SessionContext'
import StatusBar from '../../components/StatusBar'
import StatCard  from '../../components/StatCard'

const n = (v, d = 2) => v == null ? '—' : (+v).toLocaleString('en-GB', { maximumFractionDigits: d })
const BAND_META = {
  small:     { label: 'Small (<1 L)',     color: '#2f8f5b' },
  medium:    { label: 'Medium (1–5 L)',   color: '#2D4270' },
  large:     { label: 'Large (5–25 L)',   color: '#b8893a' },
  oversized: { label: 'Oversized (>25 L)', color: '#c0392b' },
  unknown:   { label: 'No dimensions',    color: '#9aa1b2' },
}

export default function StorageCalculator() {
  const { session, selectedClientId } = useSession()
  const [data, setData]     = useState(null)
  const [cost, setCost]     = useState(null)       // actual Mintsoft storage charges
  const [costDays, setCostDays] = useState(30)
  const [status, setStatus] = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState({ key: 'cbm', dir: 'desc' })

  const clientParam = session?.isWarehouse && selectedClientId ? `?clientId=${selectedClientId}` : ''
  const clientPrefix = session?.isWarehouse && selectedClientId ? `clientId=${selectedClientId}&` : ''
  const noClient = session?.isWarehouse && !selectedClientId

  const load = useCallback(async () => {
    if (noClient) { setData(null); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/storage${clientParam}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load storage')
      setData(d); setStatus({ msg: '', type: null })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }, [clientParam, noClient])
  useEffect(() => { load() }, [load])

  // Actual storage charges from Mintsoft (separate so the breakdown loads fast).
  useEffect(() => {
    if (noClient) { setCost(null); return }
    let alive = true
    setCost(null)
    fetch(`/api/storage/cost?${clientPrefix}days=${costDays}`)
      .then(r => r.json())
      .then(c => { if (alive) setCost(c) })
      .catch(() => { if (alive) setCost({ available: false }) })
    return () => { alive = false }
  }, [clientPrefix, costDays, noClient])

  const s = data?.summary

  const visible = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    let list = data.rows.filter(r => !q || r.sku.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q))
    const dir = sort.dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (typeof av === 'string') return String(av).localeCompare(String(bv)) * dir
      return ((av ?? 0) - (bv ?? 0)) * dir
    })
    return list
  }, [data, search, sort])

  const chart = useMemo(() => {
    if (!data) return null
    const bands = data.bands.filter(b => b.cbm > 0)
    return {
      series: bands.map(b => +b.cbm.toFixed(3)),
      options: {
        labels: bands.map(b => BAND_META[b.band]?.label || b.band),
        colors: bands.map(b => BAND_META[b.band]?.color || '#9aa1b2'),
        legend: { position: 'bottom', fontSize: '11px' },
        dataLabels: { enabled: true, formatter: v => `${v.toFixed(0)}%` },
        tooltip: { y: { formatter: v => `${v} m³` } },
        stroke: { width: 0 },
        chart: { fontFamily: 'inherit' },
      },
    }
  }, [data])

  const costChart = useMemo(() => {
    if (!cost?.available || !cost.series?.length) return null
    return {
      series: [{ name: 'Storage cost', data: cost.series.map(p => ({ x: new Date(p.date).getTime(), y: p.cost })) }],
      options: {
        chart: { sparkline: { enabled: false }, toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
        colors: ['#2D4270'], stroke: { width: 2, curve: 'smooth' }, fill: { opacity: 0.1 },
        xaxis: { type: 'datetime', labels: { style: { fontSize: '10px', colors: '#9aa1b2' } } },
        yaxis: { labels: { style: { fontSize: '10px', colors: '#9aa1b2' }, formatter: v => `£${v.toFixed(0)}` } },
        grid: { borderColor: '#e4e7ef', strokeDashArray: 4 },
        tooltip: { x: { format: 'dd MMM' }, y: { formatter: v => `£${v.toFixed(2)}` } },
        dataLabels: { enabled: false },
      },
    }
  }, [cost])

  const setSortKey = key => setSort(p => p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Storage Calculator</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">CBM &amp; volumetric breakdown of your on-hand stock</div>
        </div>
        <button onClick={load} disabled={loading}
          className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-1.5 transition-colors disabled:opacity-50">
          {loading ? '⟳ Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <StatusBar message={status.msg} type={status.type} />

        {noClient && (
          <div className="bg-brand-surface border border-brand-border rounded-lg p-8 text-center font-mono text-sm text-ink-muted">
            Select a client to view their storage breakdown.
          </div>
        )}

        {!noClient && s && (
          <>
            <div className="flex gap-3 flex-wrap">
              <StatCard label="Total Volume (CBM)" value={`${n(s.totalCbm, 2)} m³`} accent="primary" />
              <StatCard label="Units in Storage"   value={n(s.totalUnits, 0)} />
              <StatCard label="SKUs Stocked"       value={n(s.skusStocked, 0)} />
              <StatCard label="Volumetric Weight"  value={`${n(s.volumetricWeightKg, 0)} kg`} />
              <StatCard label="Actual Weight"      value={`${n(s.actualWeightKg, 0)} kg`} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Volume by size band */}
              <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
                <div className="font-sans font-bold text-sm text-ink mb-1">Volume by size band</div>
                <div className="font-mono text-[11px] text-ink-muted mb-2">Where your cubic volume sits.</div>
                {chart && chart.series.length > 0
                  ? <ReactApexChart options={chart.options} series={chart.series} type="donut" height={260} />
                  : <div className="font-mono text-xs text-ink-muted py-8 text-center">No dimensioned stock.</div>}
              </div>

              {/* Actual storage cost (from Mintsoft) + volumetric note */}
              <div className="bg-brand-surface border border-brand-border rounded-lg p-5 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-sans font-bold text-sm text-ink">Storage cost</div>
                    <select value={costDays} onChange={e => setCostDays(+e.target.value)}
                      className="bg-brand-bg border border-brand-border rounded px-2 py-1 font-mono text-[11px] text-ink focus:outline-none focus:border-primary">
                      {[30, 60, 90].map(d => <option key={d} value={d}>last {d} days</option>)}
                    </select>
                  </div>
                  {cost == null && <div className="font-mono text-xs text-ink-muted py-3">Loading charges…</div>}
                  {cost && !cost.available && (
                    <div className="font-mono text-[11px] text-ink-muted py-2">
                      No storage charges found in Mintsoft for this period.
                    </div>
                  )}
                  {cost?.available && (
                    <>
                      <div className="flex items-end gap-6 flex-wrap">
                        <div>
                          <div className="text-3xl font-extrabold text-ink">£{n(cost.totalCost, 2)}</div>
                          <div className="font-mono text-[11px] text-ink-muted">billed over {cost.days} days</div>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-primary">{cost.methodLabel}</div>
                          {cost.rate != null && <div className="font-mono text-[11px] text-ink-muted">£{cost.rate} {cost.rateUnit}</div>}
                          {cost.latest?.pallets != null && <div className="font-mono text-[11px] text-ink-muted">latest: {cost.latest.pallets} pallets</div>}
                          {cost.latest?.cbm != null && <div className="font-mono text-[11px] text-ink-muted">billed volume: {n(cost.latest.cbm, 2)} m³</div>}
                        </div>
                      </div>
                      {costChart && <div className="mt-2"><ReactApexChart options={costChart.options} series={costChart.series} type="area" height={120} /></div>}
                    </>
                  )}
                </div>
                <div className="border-t border-brand-border pt-3">
                  <div className="font-sans font-bold text-sm text-ink mb-1">Volumetric vs actual weight</div>
                  <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
                    Volumetric weight ({s.volWeightFactor} kg/m³) is <strong>{n(s.volumetricWeightKg, 0)} kg</strong> vs
                    {' '}<strong>{n(s.actualWeightKg, 0)} kg</strong> actual.
                    {s.volumetricWeightKg > s.actualWeightKg * 1.2
                      ? ' Your stock is light & bulky — storage cost is driven by volume, not weight.'
                      : ' Your stock is fairly dense relative to its volume.'}
                  </p>
                  {s.missingDims > 0 && (
                    <div className="mt-2 font-mono text-[10px] text-warning bg-warning/10 rounded px-2 py-1.5">
                      {s.missingDims} stocked SKU{s.missingDims > 1 ? 's' : ''} missing dimensions — not counted in our volume estimate. Add dimensions in Mintsoft for an accurate figure.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Size band table */}
            <div className="bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
              <table className="w-full text-left">
                <thead><tr className="border-b border-brand-border">
                  <Th>Size band</Th><Th align="right">SKUs</Th><Th align="right">Units</Th><Th align="right">Volume (CBM)</Th><Th align="right">% of volume</Th>
                </tr></thead>
                <tbody>
                  {data.bands.filter(b => b.skus > 0).map(b => (
                    <tr key={b.band} className="border-b border-brand-border last:border-0">
                      <td className="px-3 py-2.5 text-sm text-ink flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: BAND_META[b.band]?.color }} />
                        {BAND_META[b.band]?.label || b.band}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-muted">{b.skus}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-muted">{n(b.units, 0)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink font-bold">{n(b.cbm, 3)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-muted">{s.totalCbm > 0 ? `${(100 * b.cbm / s.totalCbm).toFixed(0)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Per-SKU breakdown */}
            <div className="flex items-center justify-between">
              <div className="font-sans font-bold text-sm text-ink">Per-SKU volume</div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU / product…"
                className="bg-brand-bg border border-brand-border rounded px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-primary min-w-[220px]" />
            </div>
            <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
              <table className="w-full text-left min-w-[820px]">
                <thead><tr className="border-b border-brand-border">
                  <Th>SKU / Product</Th>
                  <Th align="right">Dims (H×W×D cm)</Th>
                  <Th sortKey="unitLitres" sort={sort} onSort={setSortKey} align="right">Unit vol</Th>
                  <Th sortKey="qty" sort={sort} onSort={setSortKey} align="right">On hand</Th>
                  <Th sortKey="cbm" sort={sort} onSort={setSortKey} align="right">Total CBM</Th>
                  <Th sortKey="sharePct" sort={sort} onSort={setSortKey} align="right">% of vol</Th>
                </tr></thead>
                <tbody>
                  {visible.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">No SKUs match.</td></tr>}
                  {visible.map(r => (
                    <tr key={r.sku} className="border-b border-brand-border last:border-0 hover:bg-brand-surface2/40">
                      <td className="px-3 py-2.5 max-w-[280px]">
                        <div className="font-mono text-xs font-bold text-ink truncate">{r.sku}</div>
                        <div className="text-[11px] text-ink-muted truncate">{r.name}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[11px] text-ink-muted">
                        {r.heightCm ? `${r.heightCm}×${r.widthCm}×${r.depthCm}` : <span className="text-warning">no dims</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-muted">{r.unitLitres ? `${n(r.unitLitres, 1)} L` : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink">{n(r.qty, 0)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink font-bold">{n(r.cbm, 4)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-muted">{r.sharePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Th({ children, align, sortKey, sort, onSort }) {
  const active = sort && sort.key === sortKey
  return (
    <th className={`px-3 py-3 font-mono text-[9px] text-ink-dim uppercase tracking-widest ${align === 'right' ? 'text-right' : ''} ${sortKey ? 'cursor-pointer select-none hover:text-ink' : ''}`}
      onClick={sortKey ? () => onSort(sortKey) : undefined}>
      {children}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}
