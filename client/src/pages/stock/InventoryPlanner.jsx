import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession } from '../../context/SessionContext'
import StatusBar from '../../components/StatusBar'
import StatCard  from '../../components/StatCard'

// ── helpers ───────────────────────────────────────────────────────────────────
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'
const fmtDateY = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const n1 = v => v == null ? '—' : (+v).toFixed(1).replace(/\.0$/, '')
const accPct = wmape => wmape == null ? null : Math.max(0, Math.min(100, Math.round((1 - wmape) * 100)))
const daysUntil = d => d ? Math.round((new Date(d) - Date.now()) / 86400000) : null

const CLASS_META = {
  smooth:       { label: 'Smooth',       color: 'text-success' },
  erratic:      { label: 'Erratic',      color: 'text-warning' },
  intermittent: { label: 'Intermittent', color: 'text-primary' },
  lumpy:        { label: 'Lumpy',        color: 'text-gold' },
}
const FLAG_META = {
  reorder:         { label: 'Reorder',     cls: 'bg-warning/15 text-warning' },
  stockout_risk:   { label: 'Stockout risk', cls: 'bg-danger/15 text-danger' },
  overstock:       { label: 'Overstock',   cls: 'bg-primary/10 text-primary' },
  dead_stock:      { label: 'Dead stock',  cls: 'bg-ink-muted/15 text-ink-muted' },
  discontinued:    { label: 'Discontinued', cls: 'bg-ink-muted/15 text-ink-muted' },
  has_exceptional: { label: 'Exceptional orders', cls: 'bg-gold/15 text-gold' },
  has_events:      { label: 'Known order', cls: 'bg-success/15 text-success' },
}

const FILTERS = [
  { id: 'all',           label: 'All' },
  { id: 'reorder',       label: 'Reorder now' },
  { id: 'stockout_risk', label: 'Stockout risk' },
  { id: 'overstock',     label: 'Overstock' },
  { id: 'dead_stock',    label: 'Dead stock' },
]

export default function InventoryPlanner() {
  const { session, selectedClientId } = useSession()
  const [data,    setData]    = useState(null)   // { run, rows }
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [tab,     setTab]     = useState('overview')
  const [filter,  setFilter]  = useState('all')
  const [search,  setSearch]  = useState('')
  const [sort,    setSort]    = useState({ key: 'weekly_demand', dir: 'desc' })
  const [open,    setOpen]    = useState(null)

  const clientParam = session?.isWarehouse && selectedClientId ? `?clientId=${selectedClientId}` : ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/forecasting/plan${clientParam}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load plan')
      setData(d)
      setStatus({ msg: '', type: null })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }, [clientParam])

  useEffect(() => { load(); setOpen(null) }, [load])

  async function runForecast() {
    setRunning(true); setStatus({ msg: 'Recalculating forecast — this can take a moment…', type: 'info' })
    try {
      const body = session?.isWarehouse && selectedClientId ? { clientId: selectedClientId } : {}
      const res  = await fetch('/api/forecasting/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Run failed')
      setStatus({ msg: `Forecast updated — ${d.skus} SKUs, ${d.reorderCount} to reorder.`, type: 'success' })
      await load()
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setRunning(false) }
  }

  const rows = data?.rows || []
  const hasFlag = (r, f) => (r.flags || []).includes(f)

  const kpis = useMemo(() => {
    const reorder  = rows.filter(r => hasFlag(r, 'reorder'))
    const value = reorder.reduce((s, r) => s + (r.order_qty || 0) * (+r.price || 0), 0)
    return {
      skus:     rows.length,
      reorder:  reorder.length,
      stockout: rows.filter(r => hasFlag(r, 'stockout_risk')).length,
      overstock: rows.filter(r => hasFlag(r, 'overstock')).length,
      accuracy: accPct(data?.run?.stats?.horizonWmapeWithEvents ?? data?.run?.stats?.horizonWmape ?? data?.run?.stats?.wmape),
      statsAccuracy: accPct(data?.run?.stats?.horizonWmape),
      catalogueAccuracy: accPct(data?.run?.stats?.portfolioWmape),
      skuAccuracy: accPct(data?.run?.stats?.wmape),
      horizonWeeks: data?.run?.stats?.horizonWeeks || 4,
      reorderValue: value,
    }
  }, [rows, data])

  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const f of FILTERS.slice(1)) c[f.id] = rows.filter(r => hasFlag(r, f.id)).length
    return c
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows.filter(r => {
      if (filter === 'reorder' && !hasFlag(r, 'reorder')) return false
      if (filter !== 'all' && filter !== 'reorder' && !hasFlag(r, filter)) return false
      if (q && !r.sku.toLowerCase().includes(q) && !(r.name || '').toLowerCase().includes(q)) return false
      return true
    })
    // Numeric columns arrive as strings from Postgres (NUMERIC); coerce by type.
    const DATE_KEYS = new Set(['order_by_date', 'stockout_date'])
    const STR_KEYS  = new Set(['sku', 'demand_class'])
    const dir = sort.dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (STR_KEYS.has(sort.key))  return String(av).localeCompare(String(bv)) * dir
      if (DATE_KEYS.has(sort.key))  return (new Date(av) - new Date(bv)) * dir
      return (parseFloat(av) - parseFloat(bv)) * dir
    })
    return list
  }, [rows, filter, search, sort])

  const accuracyView = useMemo(() => {
    if (!rows.length) return null
    const byMethod = {}, byClass = {}
    for (const r of rows) {
      const m = (byMethod[r.method] = byMethod[r.method] || { n: 0, wsum: 0, wn: 0 })
      m.n++; if (r.wmape != null) { m.wsum += +r.wmape; m.wn++ }
      const c = (byClass[r.demand_class] = byClass[r.demand_class] || { n: 0 }); c.n++
    }
    const methods = Object.entries(byMethod)
      .map(([method, v]) => ({ method, n: v.n, avgWmape: v.wn ? v.wsum / v.wn : null }))
      .sort((a, b) => b.n - a.n)
    const classes = Object.entries(byClass).map(([c, v]) => ({ c, n: v.n })).sort((a, b) => b.n - a.n)
    return { methods, classes }
  }, [rows])

  const setSortKey = key => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  const noClient = session?.isWarehouse && !selectedClientId

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Inventory Planner</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            Demand forecasting &amp; reorder planning · 95% service · capital-efficient
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.run && (
            <div className="font-mono text-[10px] text-ink-dim hidden sm:block text-right">
              Last run<br />{fmtDateY(data.run.finished_at || data.run.started_at)}
            </div>
          )}
          {session?.isWarehouse && (
            <button onClick={runForecast} disabled={running || noClient}
              className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-1.5 transition-colors disabled:opacity-50">
              {running ? '⟳ Recalculating…' : '↻ Recalculate'}
            </button>
          )}
        </div>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <StatusBar message={status.msg} type={status.type} />

        {noClient && (
          <div className="bg-brand-surface border border-brand-border rounded-lg p-8 text-center font-mono text-sm text-ink-muted">
            Select a client to view their inventory plan.
          </div>
        )}

        {!noClient && !data?.run && !loading && (
          <div className="bg-brand-surface border border-brand-border rounded-lg p-8 text-center">
            <div className="text-3xl mb-2">📦</div>
            <div className="font-sans font-bold text-ink mb-1">No forecast yet</div>
            <div className="font-mono text-xs text-ink-muted mb-4">Run a forecast to generate demand predictions and reorder recommendations.</div>
            {session?.isWarehouse && (
              <button onClick={runForecast} disabled={running}
                className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-2 disabled:opacity-50">
                {running ? 'Running…' : 'Run first forecast'}
              </button>
            )}
          </div>
        )}

        {!noClient && data?.run && (
          <>
            {/* KPIs */}
            <div className="flex gap-3 flex-wrap">
              <StatCard label="SKUs Tracked"      value={kpis.skus} />
              <StatCard label="Reorder Now"       value={kpis.reorder}  accent={kpis.reorder ? 'warning' : 'success'} />
              <StatCard label="Stockout Risk"     value={kpis.stockout} accent={kpis.stockout ? 'danger' : 'success'} />
              <StatCard label="Overstock"         value={kpis.overstock} accent={kpis.overstock ? 'primary' : undefined} />
              <StatCard label="Forecast Accuracy" value={kpis.accuracy != null ? `${kpis.accuracy}%` : '—'}
                accent={kpis.accuracy >= 60 ? 'success' : kpis.accuracy >= 40 ? 'warning' : 'danger'} />
              {kpis.reorderValue > 0 && <StatCard label="Reorder Value" value={`£${Math.round(kpis.reorderValue).toLocaleString()}`} />}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-brand-surface2/60 border border-brand-border rounded-lg p-1 w-fit">
              <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')} label="Overview" />
              <TabBtn active={tab === 'accuracy'} onClick={() => setTab('accuracy')} label="Accuracy" />
              {session?.isWarehouse && <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')} label="Settings" />}
            </div>

            {tab === 'overview' && (
              <>
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
                    className="ml-auto bg-brand-bg border border-brand-border rounded px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-primary min-w-[200px]" />
                </div>

                <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
                  <table className="w-full text-left min-w-[1000px]">
                    <thead>
                      <tr className="border-b border-brand-border">
                        <Th>SKU / Product</Th>
                        <Th sortKey="demand_class" sort={sort} onSort={setSortKey}>Class</Th>
                        <Th sortKey="weekly_demand" sort={sort} onSort={setSortKey} align="right">Wkly demand</Th>
                        <Th sortKey="on_hand" sort={sort} onSort={setSortKey} align="right">On hand</Th>
                        <Th sortKey="on_order" sort={sort} onSort={setSortKey} align="right">On order</Th>
                        <Th sortKey="weeks_cover" sort={sort} onSort={setSortKey} align="right">Cover</Th>
                        <Th sortKey="order_qty" sort={sort} onSort={setSortKey} align="right">Order qty</Th>
                        <Th sortKey="order_by_date" sort={sort} onSort={setSortKey}>Order by</Th>
                        <Th sortKey="stockout_date" sort={sort} onSort={setSortKey}>Stockout</Th>
                        <Th sortKey="wmape" sort={sort} onSort={setSortKey} align="right">Acc.</Th>
                        <Th>Flags</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.length === 0 && (
                        <tr><td colSpan={11} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">No SKUs match.</td></tr>
                      )}
                      {visible.map(r => {
                        const cover = r.weeks_cover
                        const coverCls = cover == null ? 'text-ink-muted'
                          : cover < 2 ? 'text-danger font-bold' : cover < 4 ? 'text-warning' : 'text-ink'
                        const acc = accPct(r.wmape)
                        return (
                          <Fragment key={r.sku}>
                            <tr onClick={() => setOpen(open === r.sku ? null : r.sku)}
                              className={`border-b border-brand-border last:border-0 cursor-pointer hover:bg-brand-surface2/40 ${hasFlag(r, 'reorder') ? 'bg-warning/5' : ''}`}>
                              <td className="px-3 py-2.5 max-w-[260px]">
                                <div className="font-mono text-xs font-bold text-ink truncate">{r.sku}</div>
                                <div className="text-[11px] text-ink-muted truncate">{r.name || ''}</div>
                              </td>
                              <td className={`px-3 py-2.5 font-mono text-[11px] ${CLASS_META[r.demand_class]?.color || 'text-ink-muted'}`}>{CLASS_META[r.demand_class]?.label || r.demand_class}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-xs text-ink">{n1(r.weekly_demand)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-xs text-ink">{r.on_hand}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-muted">{r.on_order || '—'}</td>
                              <td className={`px-3 py-2.5 text-right font-mono text-xs ${coverCls}`}>{cover == null ? '∞' : `${n1(cover)}w`}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-primary">{r.order_qty > 0 ? r.order_qty : '—'}</td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-ink-muted">{r.order_qty > 0 ? fmtDate(r.order_by_date) : '—'}</td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-ink-muted">{fmtDate(r.stockout_date)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-[11px] text-ink-muted">{acc != null ? `${acc}%` : '—'}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {(r.flags || []).filter(f => FLAG_META[f]).map(f => (
                                    <span key={f} className={`text-[9px] font-bold rounded px-1.5 py-0.5 ${FLAG_META[f].cls}`}>{FLAG_META[f].label}</span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                            {open === r.sku && (
                              <tr><td colSpan={11} className="p-0 bg-brand-surface2/30">
                                <ForecastDetail sku={r.sku} row={r} clientParam={clientParam} />
                              </td></tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === 'accuracy' && accuracyView && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
                  <div className="font-sans font-bold text-sm text-ink mb-1">How accuracy is measured</div>
                  <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
                    Each SKU is back-tested on a rolling basis — we forecast past weeks we already know the answer to,
                    and compare, over your {kpis.horizonWeeks}-week replenishment window (what the reorder decision
                    depends on). <strong>Planning accuracy</strong> reflects the module used as intended — large
                    trade/pallet orders entered as <em>known</em> events, leaving only the steady baseline to forecast.
                    <strong> Baseline-only</strong> is pure statistics with nothing entered; <strong>per-SKU</strong> is
                    the strict line-item figure (sparse intermittent SKUs are inherently noisier).
                  </p>
                  <div className="mt-4 flex items-end gap-6 flex-wrap">
                    <div>
                      <div className="text-4xl font-extrabold text-ink">{kpis.accuracy != null ? `${kpis.accuracy}%` : '—'}</div>
                      <div className="font-mono text-[11px] text-ink-muted mb-1">planning accuracy<br/>(known orders entered)</div>
                    </div>
                    <div>
                      <div className="text-2xl font-extrabold text-ink-muted">{kpis.statsAccuracy != null ? `${kpis.statsAccuracy}%` : '—'}</div>
                      <div className="font-mono text-[11px] text-ink-muted mb-1">baseline only<br/>(pure statistics)</div>
                    </div>
                    <div>
                      <div className="text-2xl font-extrabold text-ink-muted">{kpis.skuAccuracy != null ? `${kpis.skuAccuracy}%` : '—'}</div>
                      <div className="font-mono text-[11px] text-ink-muted mb-1">avg per-SKU<br/>(weekly)</div>
                    </div>
                  </div>
                </div>
                <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
                  <div className="font-sans font-bold text-sm text-ink mb-3">Method leaderboard</div>
                  <table className="w-full text-left">
                    <thead><tr className="border-b border-brand-border">
                      <Th>Method</Th><Th align="right">SKUs</Th><Th align="right">Avg accuracy</Th>
                    </tr></thead>
                    <tbody>
                      {accuracyView.methods.map(m => (
                        <tr key={m.method} className="border-b border-brand-border last:border-0">
                          <td className="px-3 py-2 font-mono text-xs text-ink">{m.method}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-ink-muted">{m.n}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-ink">{m.avgWmape != null ? `${accPct(m.avgWmape)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="font-sans font-bold text-sm text-ink mt-5 mb-3">Demand classes</div>
                  <div className="flex flex-wrap gap-2">
                    {accuracyView.classes.map(c => (
                      <span key={c.c} className={`text-[11px] font-mono rounded px-2 py-1 bg-brand-surface2 ${CLASS_META[c.c]?.color || 'text-ink-muted'}`}>
                        {CLASS_META[c.c]?.label || c.c}: <strong>{c.n}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'settings' && session?.isWarehouse && (
              <ConfigPanel clientParam={clientParam} selectedClientId={selectedClientId} onChanged={load} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Settings: warehouse configures the client's forecast setup ────────────────
const CFG_FIELDS = [
  { k: 'serviceLevel',      label: 'Service level',         hint: 'target in-stock probability', type: 'pct' },
  { k: 'defaultLeadDays',   label: 'Default lead time',     hint: 'days; per-supplier/SKU below', type: 'int' },
  { k: 'defaultLeadSpread', label: 'Lead-time spread',      hint: '± days variability',           type: 'int' },
  { k: 'reviewDays',        label: 'Review period',         hint: 'days between reorder reviews',  type: 'int' },
  { k: 'maxWeeksCover',     label: 'Max weeks cover',       hint: 'capital-efficiency cap',       type: 'int' },
  { k: 'horizonWeeks',      label: 'Forecast horizon',      hint: 'weeks ahead',                  type: 'int' },
  { k: 'historyWeeks',      label: 'History window',        hint: 'weeks of history used',        type: 'int' },
  { k: 'exceptionalK',      label: 'Exceptional sensitivity', hint: 'lower = flag more as pallet/exceptional', type: 'num' },
  { k: 'defaultMoq',        label: 'Default MOQ',           hint: 'min order qty',                type: 'int' },
  { k: 'defaultMultiple',   label: 'Order multiple',        hint: 'carton/pallet rounding',       type: 'int' },
]

function ConfigPanel({ clientParam, selectedClientId, onChanged }) {
  const [cfg, setCfg]   = useState(null)
  const [form, setForm] = useState({})
  const [profile, setProfile] = useState('mixed')
  const [msg, setMsg]   = useState('')
  const [busy, setBusy] = useState(false)
  // new lead-time / event drafts
  const [lt, setLt] = useState({ supplier: '', sku: '', ltDays: '', ltSpreadDays: '' })
  const [ev, setEv] = useState({ sku: '', type: 'trade_order', startDate: '', endDate: '', qty: '', factor: '', note: '' })

  const cid = selectedClientId || ''
  const load = useCallback(async () => {
    const res = await fetch(`/api/forecasting/config${clientParam}`)
    const d = await res.json()
    setCfg(d)
    setForm(d.settings || {})
    setProfile(d.settings?.tradeProfile || d.effective?.tradeProfile || 'mixed')
  }, [clientParam])
  useEffect(() => { load() }, [load])

  const body = (extra) => ({ ...(cid ? { clientId: cid } : {}), ...extra })
  const def = k => cfg?.defaults?.[k]

  async function saveConfig() {
    setBusy(true); setMsg('')
    try {
      const settings = { ...form, tradeProfile: profile }
      const res = await fetch('/api/forecasting/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body({ settings })),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      setMsg('Settings saved. Recalculate to apply.'); onChanged && onChanged()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  async function addLeadTime() {
    if (!lt.ltDays || (!lt.supplier && !lt.sku)) { setMsg('Lead time needs a supplier or SKU, and days.'); return }
    const res = await fetch('/api/forecasting/lead-time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(lt)) })
    if (res.ok) { setLt({ supplier: '', sku: '', ltDays: '', ltSpreadDays: '' }); load() } else setMsg((await res.json()).error)
  }
  async function delLeadTime(id) { await fetch(`/api/forecasting/lead-time?id=${id}`, { method: 'DELETE' }); load() }
  async function addEvent() {
    if (!ev.startDate || (!ev.qty && !ev.factor)) { setMsg('Event needs a start date and a quantity (or promo factor).'); return }
    const res = await fetch('/api/forecasting/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(ev)) })
    if (res.ok) { setEv({ sku: '', type: 'trade_order', startDate: '', endDate: '', qty: '', factor: '', note: '' }); load() } else setMsg((await res.json()).error)
  }
  async function delEvent(id) { await fetch(`/api/forecasting/event?id=${id}`, { method: 'DELETE' }); load() }

  if (!cfg) return <div className="font-mono text-xs text-ink-muted">Loading settings…</div>
  const inputCls = 'bg-brand-bg border border-brand-border rounded px-2 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-primary w-full'

  return (
    <div className="space-y-5">
      {msg && <div className="font-mono text-[11px] text-primary bg-primary/10 rounded px-3 py-2">{msg}</div>}
      <p className="font-mono text-[11px] text-ink-muted">Configure this client's forecast setup on their behalf. Blank fields fall back to sensible defaults (shown faded). After changing settings, hit <strong>Recalculate</strong>.</p>

      {/* General config */}
      <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
        <div className="font-sans font-bold text-sm text-ink mb-3">General</div>
        <div className="mb-4">
          <label className="font-mono text-[9px] text-ink-dim uppercase tracking-widest">Trade profile</label>
          <div className="flex gap-2 mt-1">
            {['retail', 'mixed', 'all-trade'].map(p => (
              <button key={p} onClick={() => setProfile(p)}
                className={`font-sans text-xs rounded px-3 py-1.5 border ${profile === p ? 'bg-primary text-white border-primary' : 'border-brand-border text-ink-muted hover:text-ink'}`}>{p}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {CFG_FIELDS.map(f => (
            <div key={f.k}>
              <label className="font-mono text-[9px] text-ink-dim uppercase tracking-widest block">{f.label}</label>
              <input className={inputCls} type="number" step={f.type === 'num' || f.type === 'pct' ? '0.01' : '1'}
                placeholder={f.type === 'pct' ? `${Math.round((def(f.k) || 0) * 100)}%` : `${def(f.k) ?? ''}`}
                value={f.type === 'pct' ? (form[f.k] != null ? Math.round(form[f.k] * 100) : '') : (form[f.k] ?? '')}
                onChange={e => {
                  const v = e.target.value
                  setForm(s => ({ ...s, [f.k]: v === '' ? undefined : (f.type === 'pct' ? +v / 100 : +v) }))
                }} />
              <div className="font-mono text-[9px] text-ink-muted mt-0.5">{f.hint}</div>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={saveConfig} disabled={busy}
            className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-4 py-1.5 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      {/* Lead times */}
      <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
        <div className="font-sans font-bold text-sm text-ink mb-1">Lead times</div>
        <div className="font-mono text-[11px] text-ink-muted mb-3">Per-supplier defaults and per-SKU overrides. A blank supplier with a SKU = SKU-specific.</div>
        <table className="w-full text-left mb-3">
          <thead><tr className="border-b border-brand-border"><Th>Supplier</Th><Th>SKU</Th><Th align="right">Lead days</Th><Th align="right">± spread</Th><Th></Th></tr></thead>
          <tbody>
            {cfg.leadTimes.length === 0 && <tr><td colSpan={5} className="px-3 py-3 font-mono text-[11px] text-ink-muted">None — using default {def('defaultLeadDays')} days.</td></tr>}
            {cfg.leadTimes.map(l => (
              <tr key={l.id} className="border-b border-brand-border last:border-0">
                <td className="px-3 py-2 font-mono text-xs text-ink">{l.supplier || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink">{l.sku || '(all)'}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-ink">{l.lt_days}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-ink-muted">{l.lt_spread_days || 0}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => delLeadTime(l.id)} className="text-danger font-mono text-[11px] hover:underline">remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input className={inputCls} placeholder="Supplier" value={lt.supplier} onChange={e => setLt(s => ({ ...s, supplier: e.target.value }))} />
          <input className={inputCls} placeholder="SKU (optional)" value={lt.sku} onChange={e => setLt(s => ({ ...s, sku: e.target.value }))} />
          <input className={inputCls} type="number" placeholder="Lead days" value={lt.ltDays} onChange={e => setLt(s => ({ ...s, ltDays: e.target.value }))} />
          <input className={inputCls} type="number" placeholder="± spread" value={lt.ltSpreadDays} onChange={e => setLt(s => ({ ...s, ltSpreadDays: e.target.value }))} />
          <button onClick={addLeadTime} className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-3 py-1.5">Add</button>
        </div>
      </div>

      {/* Demand events */}
      <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
        <div className="font-sans font-bold text-sm text-ink mb-1">Known orders &amp; promotions</div>
        <div className="font-mono text-[11px] text-ink-muted mb-3">Enter upcoming <strong>trade/pallet orders</strong> (known quantity) or <strong>promotions</strong> (demand multiplier). These are added to the forecast as certainties — the key to high accuracy for trade clients.</div>
        <table className="w-full text-left mb-3">
          <thead><tr className="border-b border-brand-border"><Th>SKU</Th><Th>Type</Th><Th>From</Th><Th>To</Th><Th align="right">Qty / ×</Th><Th>Note</Th><Th></Th></tr></thead>
          <tbody>
            {cfg.events.length === 0 && <tr><td colSpan={7} className="px-3 py-3 font-mono text-[11px] text-ink-muted">No events entered.</td></tr>}
            {cfg.events.map(e => (
              <tr key={e.id} className="border-b border-brand-border last:border-0">
                <td className="px-3 py-2 font-mono text-xs text-ink">{e.sku || (e.category ? `cat:${e.category}` : 'all')}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{e.type}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{fmtDate(e.start_date)}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{e.end_date ? fmtDate(e.end_date) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-ink">{e.qty != null ? e.qty : (e.factor != null ? `×${e.factor}` : '—')}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-muted truncate max-w-[160px]">{e.note || ''}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => delEvent(e.id)} className="text-danger font-mono text-[11px] hover:underline">remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-start">
          <input className={inputCls} placeholder="SKU (blank=all)" value={ev.sku} onChange={e => setEv(s => ({ ...s, sku: e.target.value }))} />
          <select className={inputCls} value={ev.type} onChange={e => setEv(s => ({ ...s, type: e.target.value }))}>
            <option value="trade_order">trade order</option>
            <option value="promo">promo</option>
          </select>
          <input className={inputCls} type="date" value={ev.startDate} onChange={e => setEv(s => ({ ...s, startDate: e.target.value }))} />
          <input className={inputCls} type="date" value={ev.endDate} onChange={e => setEv(s => ({ ...s, endDate: e.target.value }))} />
          {ev.type === 'promo'
            ? <input className={inputCls} type="number" step="0.1" placeholder="× factor" value={ev.factor} onChange={e => setEv(s => ({ ...s, factor: e.target.value }))} />
            : <input className={inputCls} type="number" placeholder="Qty" value={ev.qty} onChange={e => setEv(s => ({ ...s, qty: e.target.value }))} />}
          <input className={inputCls} placeholder="Note" value={ev.note} onChange={e => setEv(s => ({ ...s, note: e.target.value }))} />
          <button onClick={addEvent} className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-3 py-1.5">Add</button>
        </div>
      </div>
    </div>
  )
}

// ── Drill-down: forecast chart + plan detail ──────────────────────────────────
function ForecastDetail({ sku, row, clientParam }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    const sep = clientParam ? '&' : '?'
    fetch(`/api/forecasting/forecast${clientParam}${sep}sku=${encodeURIComponent(sku)}`)
      .then(r => r.json())
      .then(j => { if (alive) setD(j) })
      .catch(e => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [sku, clientParam])

  if (err) return <div className="px-4 py-4 font-mono text-xs text-danger">{err}</div>
  if (!d)  return <div className="px-4 py-6 font-mono text-xs text-ink-muted">Loading forecast…</div>

  const histPts = (d.history || []).map(h => ({ x: new Date(h.week).getTime(), y: h.units }))
  const fcPts   = (d.forecast || []).map(f => ({ x: new Date(f.bucket_date).getTime(), y: +(+f.yhat).toFixed(1) }))
  const bandPts = (d.forecast || []).map(f => ({ x: new Date(f.bucket_date).getTime(), y: [+(+f.yhat_lo).toFixed(1), +(+f.yhat_hi).toFixed(1)] }))
  // Connect history to forecast: forecast line starts from last actual point.
  if (histPts.length && fcPts.length) fcPts.unshift({ x: histPts[histPts.length - 1].x, y: histPts[histPts.length - 1].y })

  const series = [
    { name: 'Forecast range', type: 'rangeArea', data: bandPts },
    { name: 'Actual',         type: 'line',      data: histPts },
    { name: 'Forecast',       type: 'line',      data: fcPts },
  ]
  const options = {
    chart: { height: 240, toolbar: { show: false }, animations: { enabled: false }, fontFamily: 'inherit' },
    colors: ['#2D4270', '#2D4270', '#b8893a'],
    fill: { opacity: [0.12, 1, 1], type: ['solid', 'solid', 'solid'] },
    stroke: { width: [0, 2.5, 2.5], dashArray: [0, 0, 5], curve: 'straight' },
    legend: { show: true, position: 'top', horizontalAlign: 'right', fontSize: '11px', markers: { width: 8, height: 8 } },
    xaxis: { type: 'datetime', labels: { style: { fontSize: '10px', colors: '#9aa1b2' }, datetimeFormatter: { month: "MMM 'yy" } } },
    yaxis: { min: 0, labels: { style: { fontSize: '10px', colors: '#9aa1b2' }, formatter: v => Math.round(v) } },
    grid: { borderColor: '#e4e7ef', strokeDashArray: 4 },
    tooltip: { x: { format: 'dd MMM yyyy' } },
    dataLabels: { enabled: false },
  }

  const Stat = ({ label, value, hint }) => (
    <div>
      <div className="font-mono text-[9px] text-ink-dim uppercase tracking-widest">{label}</div>
      <div className="font-mono text-sm text-ink font-bold">{value}</div>
      {hint && <div className="font-mono text-[10px] text-ink-muted">{hint}</div>}
    </div>
  )

  return (
    <div className="px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2">
        <div className="font-mono text-[10px] text-ink-muted uppercase tracking-widest mb-1">Demand history &amp; 12-week forecast</div>
        <ReactApexChart options={options} series={series} type="line" height={240} />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 content-start">
        <Stat label="Method"        value={row.method} />
        <Stat label="Demand class"  value={CLASS_META[row.demand_class]?.label || row.demand_class} />
        <Stat label="Weekly demand" value={n1(row.weekly_demand)} />
        <Stat label="Weeks cover"   value={row.weeks_cover == null ? '∞' : `${n1(row.weeks_cover)}w`} />
        <Stat label="Reorder point" value={n1(row.reorder_point)} hint={`safety ${n1(row.safety_stock)}`} />
        <Stat label="Order qty"     value={row.order_qty > 0 ? row.order_qty : '—'} hint={row.order_qty > 0 ? `by ${fmtDate(row.order_by_date)}` : ''} />
        <Stat label="Lead time"     value={`${row.lead_days} days`} />
        <Stat label="Accuracy"      value={accPct(row.wmape) != null ? `${accPct(row.wmape)}%` : '—'} hint={row.mase != null ? `MASE ${(+row.mase).toFixed(2)} · bias ${(+row.bias).toFixed(1)}` : ''} />
        {row.exceptional_units > 0 && (
          <div className="col-span-2 text-[10px] font-mono text-gold bg-gold/10 rounded px-2 py-1.5">
            {row.exceptional_units} units in exceptional/pallet orders were de-peaked from the baseline.
          </div>
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, label }) {
  return (
    <button onClick={onClick}
      className={`font-sans font-bold text-xs rounded px-3 py-1.5 transition-colors ${active ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink'}`}>
      {label}
    </button>
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
