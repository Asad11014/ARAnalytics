import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSession } from '../../context/SessionContext'
import StatusBar from '../../components/StatusBar'
import StatCard  from '../../components/StatCard'

const n = (v, d = 0) => v == null ? '—' : (+v).toLocaleString('en-GB', { maximumFractionDigits: d })

const STATUS_META = {
  dead:    { label: 'Dead',    cls: 'bg-danger/15 text-danger',   blurb: 'No sales in the window' },
  excess:  { label: 'Excess',  cls: 'bg-warning/15 text-warning', blurb: 'More than target cover' },
  healthy: { label: 'Healthy', cls: 'bg-success/15 text-success', blurb: 'Within target cover' },
  low:     { label: 'Low',     cls: 'bg-primary/10 text-primary', blurb: 'Under 2 weeks cover' },
}
const FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'dead',    label: 'Dead' },
  { id: 'excess',  label: 'Excess' },
  { id: 'healthy', label: 'Healthy' },
  { id: 'low',     label: 'Low' },
]

export default function ExcessStock() {
  const { session, selectedClientId } = useSession()
  const [data, setData]     = useState(null)
  const [status, setStatus] = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const [days, setDays]     = useState(90)
  const [targetWeeks, setTargetWeeks] = useState(12)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState({ key: 'excessCbm', dir: 'desc' })
  const [cost, setCost]     = useState(null)       // Mintsoft storage rate, for £ of freed volume

  const clientPrefix = session?.isWarehouse && selectedClientId ? `clientId=${selectedClientId}&` : ''
  const noClient = session?.isWarehouse && !selectedClientId

  const load = useCallback(async () => {
    if (noClient) { setData(null); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/excess?${clientPrefix}days=${days}&targetWeeks=${targetWeeks}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load excess stock')
      setData(d); setStatus({ msg: '', type: null })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }, [clientPrefix, noClient, days, targetWeeks])
  useEffect(() => { load() }, [load])

  // Storage rate (for pricing the freed volume on volumetric clients).
  useEffect(() => {
    if (noClient) { setCost(null); return }
    let alive = true
    fetch(`/api/storage/cost?${clientPrefix}days=30`).then(r => r.json())
      .then(c => { if (alive) setCost(c) }).catch(() => { if (alive) setCost({ available: false }) })
    return () => { alive = false }
  }, [clientPrefix, noClient])

  const s = data?.summary
  // £/month of storage tied up in excess+dead, when the client is billed volumetrically.
  const freeableCbm = s ? (s.totalExcessCbm + s.deadCbm) : 0
  const monthlyCost = (cost?.available && cost.method === 'Volumetric' && cost.rate)
    ? freeableCbm * cost.rate * 30 : null

  const counts = useMemo(() => {
    const c = { all: data?.rows.length || 0 }
    for (const f of FILTERS.slice(1)) c[f.id] = (data?.rows || []).filter(r => r.status === f.id).length
    return c
  }, [data])

  const visible = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    let list = data.rows.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false
      if (q && !r.sku.toLowerCase().includes(q) && !(r.name || '').toLowerCase().includes(q)) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (av == null && bv == null) return 0
      if (av == null) return 1; if (bv == null) return -1
      if (typeof av === 'string') return String(av).localeCompare(String(bv)) * dir
      return (av - bv) * dir
    })
    return list
  }, [data, filter, search, sort])

  const setSortKey = key => setSort(p => p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Excess Stock</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Slow-moving, overstocked &amp; dead stock — and the storage volume tied up</div>
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
            Select a client to view their excess stock.
          </div>
        )}

        {!noClient && s && (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-end gap-4 bg-brand-surface border border-brand-border rounded-lg p-4">
              <div>
                <label className="font-mono text-[9px] text-ink-dim uppercase tracking-widest block mb-1">Sales window</label>
                <select value={days} onChange={e => setDays(+e.target.value)}
                  className="bg-brand-bg border border-brand-border rounded px-2.5 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-primary">
                  {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
                </select>
              </div>
              <div>
                <label className="font-mono text-[9px] text-ink-dim uppercase tracking-widest block mb-1">Target cover</label>
                <select value={targetWeeks} onChange={e => setTargetWeeks(+e.target.value)}
                  className="bg-brand-bg border border-brand-border rounded px-2.5 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-primary">
                  {[4, 8, 12, 16, 26, 52].map(w => <option key={w} value={w}>{w} weeks</option>)}
                </select>
              </div>
              <div className="font-mono text-[11px] text-ink-muted">Stock above {targetWeeks} weeks of cover (at the last {days} days' sales rate) counts as excess.</div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <StatCard label="Excess SKUs"     value={n(s.excessCount)} accent={s.excessCount ? 'warning' : 'success'} />
              <StatCard label="Dead SKUs"       value={n(s.deadCount)}   accent={s.deadCount ? 'danger' : 'success'} />
              <StatCard label="Excess Units"    value={n(s.totalExcessUnits)} />
              <StatCard label="Volume Tied Up"  value={`${n(s.totalExcessCbm, 2)} m³`} accent="primary" />
              <StatCard label="Dead Volume"     value={`${n(s.deadCbm, 2)} m³`} />
            </div>

            {(s.totalExcessCbm > 0 || s.deadCbm > 0) && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 font-mono text-xs text-ink">
                Acting on excess &amp; dead stock could free up <strong>{n(s.totalExcessCbm + s.deadCbm, 2)} m³</strong> of storage
                ({n(s.totalExcessUnits + s.deadUnits)} units)
                {monthlyCost != null
                  ? <> — about <strong>£{n(monthlyCost, 0)}/month</strong> in storage charges at your {cost.methodLabel.toLowerCase()} rate (£{cost.rate} {cost.rateUnit}).</>
                  : cost?.available && cost.method === 'PerPalletUnit'
                    ? <> — reducing the pallet count you're billed for (£{cost.rate} {cost.rateUnit}).</>
                    : <> — reducing storage cost and tied-up capital.</>}
              </div>
            )}

            {/* Filters + search */}
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  className={`font-sans text-xs rounded-full px-3 py-1.5 border transition-colors ${filter === f.id
                    ? 'bg-primary text-white border-primary' : 'border-brand-border text-ink-muted hover:text-ink'}`}>
                  {f.label} <span className="opacity-70">{counts[f.id] ?? 0}</span>
                </button>
              ))}
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU / product…"
                className="ml-auto bg-brand-bg border border-brand-border rounded px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-primary min-w-[220px]" />
            </div>

            <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
              <table className="w-full text-left min-w-[920px]">
                <thead><tr className="border-b border-brand-border">
                  <Th>SKU / Product</Th>
                  <Th sortKey="qty" sort={sort} onSort={setSortKey} align="right">On hand</Th>
                  <Th sortKey="soldInWindow" sort={sort} onSort={setSortKey} align="right">Sold ({days}d)</Th>
                  <Th sortKey="weeklyDemand" sort={sort} onSort={setSortKey} align="right">Wkly demand</Th>
                  <Th sortKey="weeksCover" sort={sort} onSort={setSortKey} align="right">Weeks cover</Th>
                  <Th sortKey="excessUnits" sort={sort} onSort={setSortKey} align="right">Excess units</Th>
                  <Th sortKey="excessCbm" sort={sort} onSort={setSortKey} align="right">Excess vol</Th>
                  <Th>Status</Th>
                </tr></thead>
                <tbody>
                  {visible.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">No SKUs match.</td></tr>}
                  {visible.map(r => {
                    const cover = r.weeksCover
                    const coverCls = cover == null ? 'text-danger font-bold' : cover > targetWeeks ? 'text-warning' : 'text-ink'
                    return (
                      <tr key={r.sku} className="border-b border-brand-border last:border-0 hover:bg-brand-surface2/40">
                        <td className="px-3 py-2.5 max-w-[280px]">
                          <div className="font-mono text-xs font-bold text-ink truncate">{r.sku}</div>
                          <div className="text-[11px] text-ink-muted truncate">{r.name}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-ink">{n(r.qty)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-muted">{n(r.soldInWindow)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-muted">{n(r.weeklyDemand, 1)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono text-xs ${coverCls}`}>{cover == null ? '∞' : `${n(cover, 1)}w`}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-ink font-bold">{r.excessUnits > 0 ? n(r.excessUnits) : '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-primary">{r.excessCbm > 0 ? `${n(r.excessCbm, 3)} m³` : '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[9px] font-bold rounded px-1.5 py-0.5 ${STATUS_META[r.status]?.cls}`}>{STATUS_META[r.status]?.label}</span>
                          {r.discontinued && <span className="ml-1 text-[9px] font-bold rounded px-1.5 py-0.5 bg-ink-muted/15 text-ink-muted">Discont.</span>}
                        </td>
                      </tr>
                    )
                  })}
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
