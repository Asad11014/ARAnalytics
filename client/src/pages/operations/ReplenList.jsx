import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSession } from '../../context/SessionContext'
import StatusBar from '../../components/StatusBar'
import StatCard  from '../../components/StatCard'

// Export the replen list as a CSV the replen picker can print and tick off.
function exportReplenCsv(tasks) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = [['Done', 'Pick Location', 'SKU', 'Product', 'Current', 'Replen Point', 'Qty to Replen', 'Replen From', 'Source Type', 'Source Qty', 'Short']]
  tasks.forEach(t => rows.push([
    '[  ]', t.pickLocation, t.sku, t.name, t.currentQty, t.replenPoint,
    t.qtyToReplen, t.replenFrom || 'NONE', t.replenFromType || '', t.replenFromQty,
    t.shortfall > 0 ? t.shortfall : '',
  ]))
  const csv  = rows.map(r => r.map(esc).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = `replen-list.csv`
  a.click()
}

export default function ReplenList() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [tasks,   setTasks]   = useState(null)
  const [meta,    setMeta]    = useState(null)
  const [locQuery, setLocQuery] = useState('')
  const [showUnactionable, setShowUnactionable] = useState(false)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)

  const clientName = useMemo(() => {
    if (!selectedClientId) return null
    const c = (session?.clients || []).find(c => String(c.ID || c.id) === String(selectedClientId))
    return c?.Name || c?.name || `#${selectedClientId}`
  }, [selectedClientId, session])

  const run = useCallback(async () => {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setTasks(null)
    setStatus({ msg: 'Checking pick faces against replen points…', type: 'loading' })
    try {
      const params = new URLSearchParams({ warehouseId })
      if (selectedClientId) params.set('clientId', selectedClientId)
      const res  = await fetch(`/api/replen?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to build replen list')
      setTasks(json.tasks || [])
      setMeta(json.meta || {})
      setStatus({ msg: `${json.meta?.totalTasks ?? 0} pick faces need replenishing`, type: json.meta?.totalTasks ? 'warning' : 'success' })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [warehouseId, selectedClientId])

  // Re-fetch when warehouse or the global client selector changes.
  useEffect(() => { run() }, [warehouseId, selectedClientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Location filter is instant / client-side.
  const locationFiltered = useMemo(() => {
    if (!tasks) return null
    const q = locQuery.trim().toUpperCase()
    if (!q) return tasks
    return tasks.filter(t => t.pickLocation.toUpperCase().includes(q))
  }, [tasks, locQuery])

  // Tasks with no replen source are unactionable — hidden unless toggled on.
  const unactionableCount = useMemo(
    () => locationFiltered ? locationFiltered.filter(t => !t.replenFrom).length : 0,
    [locationFiltered]
  )

  const visible = useMemo(() => {
    if (!locationFiltered) return null
    return showUnactionable ? locationFiltered : locationFiltered.filter(t => t.replenFrom)
  }, [locationFiltered, showUnactionable])

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Replenishment List</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            Pick faces at or below their replen point{clientName ? ` · ${clientName}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {visible && visible.length > 0 && (
            <button onClick={() => exportReplenCsv(visible)}
              className="border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">
              Export CSV
            </button>
          )}
          <button onClick={run} disabled={loading}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-1.5 transition-colors disabled:opacity-50">
            {loading ? '⟳ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        {/* Filters */}
        <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-3 sm:py-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Filters</div>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Location contains</label>
              <input
                value={locQuery}
                onChange={e => setLocQuery(e.target.value)}
                placeholder="e.g. 2E14"
                className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-44 focus:outline-none focus:border-primary"
              />
            </div>
            {unactionableCount > 0 && (
              <button
                onClick={() => setShowUnactionable(s => !s)}
                className={`font-mono text-[11px] px-3 py-2 rounded border transition-colors ${
                  showUnactionable
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-brand-border text-ink-muted hover:border-primary hover:text-primary'
                }`}>
                {showUnactionable ? 'Hide unactionable' : `Show ${unactionableCount} unactionable`}
              </button>
            )}
            <p className="font-mono text-[10px] text-ink-dim leading-relaxed max-w-md pb-1">
              Filter by client using the selector in the sidebar. Location filter is applied instantly.
              Faces with no replen source are hidden by default.
            </p>
          </div>
        </div>

        <StatusBar message={status.msg} type={status.type} />

        {meta && (
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Pick Faces to Replen" value={visible?.length ?? meta.totalTasks} accent={meta.totalTasks ? 'warning' : 'success'} />
            <StatCard label="With Source"  value={meta.withSource} accent="success" />
            <StatCard label="No Source"    value={meta.noSource}   accent={meta.noSource > 0 ? 'danger' : undefined} />
            <StatCard label="Short on Bulk" value={meta.shortfalls} accent={meta.shortfalls > 0 ? 'danger' : undefined} />
          </div>
        )}

        {visible && (
          <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
            <table className="w-full text-left min-w-[820px]">
              <thead>
                <tr className="border-b border-brand-border">
                  <Th>Pick Location</Th>
                  <Th>SKU</Th>
                  <Th>Product</Th>
                  <Th align="right">Current</Th>
                  <Th align="right">Replen Pt</Th>
                  <Th align="right">Qty to Replen</Th>
                  <Th>Replen From</Th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">
                    {!tasks?.length
                      ? 'Nothing needs replenishing. 🎉'
                      : unactionableCount > 0
                        ? `No actionable replens. ${unactionableCount} face${unactionableCount !== 1 ? 's' : ''} have no replen source — use “Show unactionable”.`
                        : 'No pick faces match this location filter.'}
                  </td></tr>
                )}
                {visible.map((t, i) => (
                  <tr key={i} className="border-b border-brand-border last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink">
                      {t.pickLocation}
                      {t.pickType !== 'PICK' && <span className="ml-1 text-[9px] text-ink-dim">{t.pickType}</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink">{t.sku}</td>
                    <td className="px-4 py-2.5 text-sm text-ink">{t.name || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-warning font-semibold">{t.currentQty}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-ink-muted">{t.replenPoint}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-bold text-primary">{t.qtyToReplen}</td>
                    <td className="px-4 py-2.5">
                      {t.replenFrom ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-ink">{t.replenFrom}</span>
                          <span className="font-mono text-[9px] text-ink-dim uppercase">{t.replenFromType}</span>
                          <span className="font-mono text-[10px] text-ink-muted">avail {t.replenFromQty}</span>
                          {t.shortfall > 0 && (
                            <span className="font-mono text-[9px] text-danger font-bold uppercase">short {t.shortfall}</span>
                          )}
                        </div>
                      ) : (
                        <span className="font-mono text-xs text-danger font-semibold">NO SOURCE</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Th({ children, align = 'left' }) {
  return (
    <th className={`px-4 py-3 font-mono text-[9px] text-ink-dim uppercase tracking-widest text-${align}`}>
      {children}
    </th>
  )
}
