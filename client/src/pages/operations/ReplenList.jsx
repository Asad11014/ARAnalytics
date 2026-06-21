import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSession } from '../../context/SessionContext'
import StatusBar from '../../components/StatusBar'
import StatCard  from '../../components/StatCard'

function downloadCsv(filename, header, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}

export default function ReplenList() {
  const { warehouseId, selectedClientId, session } = useSession()
  const [data,    setData]    = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const [tab,     setTab]     = useState('offhand') // 'offhand' | 'pick'
  const [search,  setSearch]  = useState('')
  const [showUnactionable, setShowUnactionable] = useState(false)

  const clientName = useMemo(() => {
    if (!selectedClientId) return null
    const c = (session?.clients || []).find(c => String(c.ID || c.id) === String(selectedClientId))
    return c?.Name || c?.name || `#${selectedClientId}`
  }, [selectedClientId, session])

  const run = useCallback(async () => {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setData(null)
    setStatus({ msg: 'Checking stock against replen points…', type: 'loading' })
    try {
      const params = new URLSearchParams({ warehouseId })
      if (selectedClientId) params.set('clientId', selectedClientId)
      const res  = await fetch(`/api/replen?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to build replen lists')
      setData(json)
      setStatus({ msg: '', type: null })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally { setLoading(false) }
  }, [warehouseId, selectedClientId])

  useEffect(() => { run() }, [warehouseId, selectedClientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toUpperCase()

  // ── List 1: off-hand storage ──
  const offhand = useMemo(() => {
    const list = data?.offhandReplen || []
    if (!q) return list
    return list.filter(t => t.sku.toUpperCase().includes(q) || (t.replenFrom || '').toUpperCase().includes(q))
  }, [data, q])

  // ── List 2: pick faces ──
  const pickAll = data?.pickReplen || []
  const pickUnactionable = pickAll.filter(t => !t.replenFrom).length
  const pick = useMemo(() => {
    let list = pickAll
    if (!showUnactionable) list = list.filter(t => t.replenFrom)
    if (q) list = list.filter(t => t.sku.toUpperCase().includes(q) || t.pickLocation.toUpperCase().includes(q))
    return list
  }, [pickAll, showUnactionable, q])

  // ── List 3: awaiting replen ──
  const awaiting = useMemo(() => {
    const list = data?.awaitingReplen || []
    if (!q) return list
    return list.filter(t => t.sku.toUpperCase().includes(q) || (t.name || '').toUpperCase().includes(q) ||
      (t.via || []).some(v => v.toUpperCase().includes(q)) ||
      t.locations.some(l => l.location.toUpperCase().includes(q)))
  }, [data, q])

  function exportOffhand() {
    downloadCsv('offhand-replen.csv',
      ['SKU', 'Product', 'Warehouse Qty', 'Replen Point', 'Qty to Replen', 'Replen From', 'Source Type', 'Available', 'Short'],
      offhand.map(t => [t.sku, t.name, t.warehouseQty, t.replenPoint, t.qtyToReplen, t.replenFrom, t.replenFromType, t.replenFromQty, t.shortfall > 0 ? t.shortfall : '']))
  }
  function exportPick() {
    downloadCsv('pick-face-replen.csv',
      ['Done', 'Pick Location', 'SKU', 'Product', 'Current', 'Replen Point', 'Qty to Replen', 'Replen From (BULK)', 'Available', 'Short'],
      pick.map(t => ['[  ]', t.pickLocation, t.sku, t.name, t.currentQty, t.replenPoint, t.qtyToReplen, t.replenFrom || 'NONE', t.replenFromQty, t.shortfall > 0 ? t.shortfall : '']))
  }
  function exportAwaiting() {
    downloadCsv('awaiting-replen.csv',
      ['SKU', 'Product', 'From Bundle', 'Quantity', 'Orders', 'Stock Locations'],
      awaiting.map(t => [t.sku, t.name, (t.via || []).join(', '), t.quantity, t.orderCount,
        t.locations.map(l => `${l.location} (${l.type}:${l.qty})`).join('; ') || 'No stock in any location']))
  }
  const exportActive = tab === 'offhand' ? exportOffhand : tab === 'pick' ? exportPick : exportAwaiting

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Replenishment</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            Restock the warehouse from off-hand storage, and pick faces from bulk{clientName ? ` · ${clientName}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={exportActive}
            className="border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">
            Export CSV
          </button>
          <button onClick={run} disabled={loading}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-1.5 transition-colors disabled:opacity-50">
            {loading ? '⟳ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-brand-border">
          <TabBtn active={tab === 'offhand'} onClick={() => setTab('offhand')}
            label="Off-Hand Storage" count={data?.offhandReplen?.length} />
          <TabBtn active={tab === 'pick'} onClick={() => setTab('pick')}
            label="Pick Faces (from Bulk)" count={data?.meta?.pick?.withSource} />
          <TabBtn active={tab === 'awaiting'} onClick={() => setTab('awaiting')}
            label="Awaiting Replen" count={data?.awaitingReplen?.length} />
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU or location…"
            className="bg-brand-surface border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-56 focus:outline-none focus:border-primary" />
          {tab === 'pick' && pickUnactionable > 0 && (
            <button onClick={() => setShowUnactionable(s => !s)}
              className={`font-mono text-[11px] px-3 py-2 rounded border transition-colors ${
                showUnactionable ? 'border-primary text-primary bg-primary/5' : 'border-brand-border text-ink-muted hover:border-primary hover:text-primary'
              }`}>
              {showUnactionable ? 'Hide unactionable' : `Show ${pickUnactionable} with no bulk source`}
            </button>
          )}
        </div>

        <StatusBar message={status.msg} type={status.type} />

        {/* ── Off-Hand Storage tab ── */}
        {tab === 'offhand' && data && (
          <>
            <div className="flex gap-3 flex-wrap">
              <StatCard label="SKUs to Restock" value={offhand.length} accent={offhand.length ? 'warning' : 'success'} />
              <StatCard label="Short on Off-Hand Stock" value={data.meta?.offhand?.shortfalls} accent={data.meta?.offhand?.shortfalls > 0 ? 'danger' : undefined} />
            </div>
            <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
              <table className="w-full text-left min-w-[760px]">
                <thead><tr className="border-b border-brand-border">
                  <Th>SKU</Th><Th>Product</Th><Th align="right">Warehouse Qty</Th><Th align="right">Replen Pt</Th>
                  <Th align="right">Qty to Replen</Th><Th>Replen From (Off-Hand)</Th>
                </tr></thead>
                <tbody>
                  {offhand.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">Nothing needs restocking from off-hand storage. 🎉</td></tr>
                  )}
                  {offhand.map((t, i) => (
                    <tr key={i} className="border-b border-brand-border last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink">{t.sku}</td>
                      <td className="px-4 py-2.5 text-sm text-ink">{t.name || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-warning font-semibold">{t.warehouseQty}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-ink-muted">{t.replenPoint}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm font-bold text-primary">{t.qtyToReplen}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-ink">{t.replenFrom}</span>
                          <span className="font-mono text-[9px] text-ink-dim uppercase">{t.replenFromType}</span>
                          <span className="font-mono text-[10px] text-ink-muted">avail {t.replenFromQty}</span>
                          {t.shortfall > 0 && <span className="font-mono text-[9px] text-danger font-bold uppercase">short {t.shortfall}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Pick Faces tab ── */}
        {tab === 'pick' && data && (
          <>
            <div className="flex gap-3 flex-wrap">
              <StatCard label="Pick Faces to Replen" value={pick.length} accent={pick.length ? 'warning' : 'success'} />
              <StatCard label="With Bulk Source" value={data.meta?.pick?.withSource} accent="success" />
              <StatCard label="No Bulk Source" value={data.meta?.pick?.noSource} accent={data.meta?.pick?.noSource > 0 ? 'danger' : undefined} />
            </div>
            <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
              <table className="w-full text-left min-w-[820px]">
                <thead><tr className="border-b border-brand-border">
                  <Th>Pick Location</Th><Th>SKU</Th><Th>Product</Th><Th align="right">Current</Th>
                  <Th align="right">Replen Pt</Th><Th align="right">Qty to Replen</Th><Th>Replen From (Bulk)</Th>
                </tr></thead>
                <tbody>
                  {pick.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">
                      {pickAll.length ? 'No actionable pick-face replens (use the toggle to show ones with no bulk source).' : 'No pick faces need replenishing. 🎉'}
                    </td></tr>
                  )}
                  {pick.map((t, i) => (
                    <tr key={i} className="border-b border-brand-border last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink">
                        {t.pickLocation}{t.pickType !== 'PICK' && <span className="ml-1 text-[9px] text-ink-dim">{t.pickType}</span>}
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
                            <span className="font-mono text-[9px] text-ink-dim uppercase">BULK</span>
                            <span className="font-mono text-[10px] text-ink-muted">avail {t.replenFromQty}</span>
                            {t.shortfall > 0 && <span className="font-mono text-[9px] text-danger font-bold uppercase">short {t.shortfall}</span>}
                          </div>
                        ) : <span className="font-mono text-xs text-danger font-semibold">NO BULK SOURCE</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Awaiting Replen tab ── */}
        {tab === 'awaiting' && data && (
          <>
            <div className="flex gap-3 flex-wrap">
              <StatCard label="SKUs Awaiting Replen" value={awaiting.length} accent={awaiting.length ? 'warning' : 'success'} />
            </div>
            <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
              <table className="w-full text-left min-w-[760px]">
                <thead><tr className="border-b border-brand-border">
                  <Th>SKU</Th><Th>Product</Th><Th align="right">Qty Needed</Th><Th align="right">Orders</Th><Th>Stock Locations</Th>
                </tr></thead>
                <tbody>
                  {awaiting.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">No orders are awaiting replen. 🎉</td></tr>
                  )}
                  {awaiting.map((t, i) => (
                    <tr key={i} className="border-b border-brand-border last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink">
                        {t.sku}
                        {(t.via || []).length > 0 && (
                          <span className="block font-normal text-[10px] text-ink-muted mt-0.5">from bundle {t.via.join(', ')}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-ink">{t.name || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm font-bold text-primary">{t.quantity}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-ink-muted">{t.orderCount}</td>
                      <td className="px-4 py-2.5">
                        {t.locations.length === 0
                          ? <span className="font-mono text-xs text-danger font-semibold">No stock in any location</span>
                          : <div className="flex flex-wrap gap-1.5">
                              {t.locations.map((l, j) => (
                                <span key={j} className="font-mono text-[10px] bg-brand-surface2 rounded px-1.5 py-0.5">
                                  <span className="font-bold text-ink">{l.location}</span>
                                  <span className="text-ink-dim"> {l.type}</span>
                                  <span className="text-ink-muted"> ×{l.qty}</span>
                                </span>
                              ))}
                            </div>}
                      </td>
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

function TabBtn({ active, onClick, label, count }) {
  return (
    <button onClick={onClick}
      className={`font-sans text-sm px-4 py-2.5 -mb-px border-b-2 transition-colors ${
        active ? 'border-primary text-primary font-bold' : 'border-transparent text-ink-muted hover:text-ink'
      }`}>
      {label}{count != null && <span className="ml-1.5 font-mono text-[11px] text-ink-dim">({count})</span>}
    </button>
  )
}
function Th({ children, align = 'left' }) {
  return <th className={`px-4 py-3 font-mono text-[9px] text-ink-dim uppercase tracking-widest text-${align}`}>{children}</th>
}
