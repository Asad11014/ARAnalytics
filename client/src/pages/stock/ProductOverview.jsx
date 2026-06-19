import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSession } from '../../context/SessionContext'
import StatusBar from '../../components/StatusBar'
import StatCard  from '../../components/StatCard'

// Split a comma-joined "Cat1, Cat2" field into individual values.
const splitList = v => (v || '').split(',').map(s => s.trim()).filter(Boolean)

export default function ProductOverview() {
  const { session, selectedClientId } = useSession()
  const [products, setProducts] = useState(null)
  const [status,   setStatus]   = useState({ msg: '', type: null })
  const [loading,  setLoading]  = useState(false)

  // Filters
  const [search,           setSearch]          = useState('')
  const [category,         setCategory]        = useState('all')
  const [supplier,         setSupplier]        = useState('all')
  const [hideZeroStock,    setHideZeroStock]   = useState(false)
  const [hideBundles,      setHideBundles]     = useState(false)
  const [showDiscontinued, setShowDiscontinued]= useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (session?.isWarehouse && selectedClientId) params.set('clientId', selectedClientId)
      const res  = await fetch(`/api/products/overview?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load products')
      setProducts(data.products || [])
      setStatus({ msg: `${(data.products || []).length} products`, type: 'success' })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [session, selectedClientId])

  useEffect(() => { load() }, [load])

  // Distinct dropdown options from the (comma-joined) fields.
  const categoryOptions = useMemo(() => {
    const set = new Set()
    ;(products || []).forEach(p => splitList(p.category).forEach(c => set.add(c)))
    return [...set].sort()
  }, [products])

  const supplierOptions = useMemo(() => {
    const set = new Set()
    ;(products || []).forEach(p => splitList(p.supplier).forEach(s => set.add(s)))
    return [...set].sort()
  }, [products])

  const visible = useMemo(() => {
    if (!products) return null
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (q && !p.sku.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false
      if (category !== 'all' && !splitList(p.category).includes(category)) return false
      if (supplier !== 'all' && !splitList(p.supplier).includes(supplier)) return false
      if (hideBundles && p.type === 'Bundle') return false
      if (!showDiscontinued && p.discontinued) return false
      if (hideZeroStock && (p.inventory === null || p.inventory <= 0)) return false
      return true
    })
  }, [products, search, category, supplier, hideBundles, showDiscontinued, hideZeroStock])

  const stats = useMemo(() => {
    if (!visible) return null
    return {
      total:     visible.length,
      inStock:   visible.filter(p => p.inventory !== null && p.inventory > 0).length,
      zeroStock: visible.filter(p => p.inventory === 0).length,
      newSkus:   visible.filter(p => p.inventory === null).length,
    }
  }, [visible])

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Product Overview</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            All products with current on-hand stock
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-1.5 transition-colors disabled:opacity-50">
          {loading ? '⟳ Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        {/* Filters */}
        <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-4 space-y-3">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest">▸ Filters</div>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Search</label>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="SKU or name"
                className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink w-48 focus:outline-none focus:border-primary" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink focus:outline-none focus:border-primary">
                <option value="all">All categories</option>
                {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Supplier</label>
              <select value={supplier} onChange={e => setSupplier(e.target.value)}
                className="bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink focus:outline-none focus:border-primary">
                <option value="all">All suppliers</option>
                {supplierOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 pb-1">
              <Toggle checked={hideZeroStock}    onChange={setHideZeroStock}    label="Hide zero stock" />
              <Toggle checked={hideBundles}      onChange={setHideBundles}      label="Hide bundles" />
            </div>
            <div className="flex flex-col gap-1.5 pb-1">
              <Toggle checked={showDiscontinued} onChange={setShowDiscontinued} label="Show discontinued" />
            </div>
          </div>
        </div>

        <StatusBar message={status.msg} type={status.type} />

        {stats && (
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Products Shown" value={stats.total} />
            <StatCard label="In Stock"   value={stats.inStock} accent="success" />
            <StatCard label="Zero Stock" value={stats.zeroStock} accent={stats.zeroStock > 0 ? 'warning' : undefined} />
            <StatCard label="New SKUs"   value={stats.newSkus} accent={stats.newSkus > 0 ? 'warning' : undefined} />
          </div>
        )}

        {visible && (
          <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
            <table className="w-full text-left min-w-[760px]">
              <thead>
                <tr className="border-b border-brand-border">
                  <Th>SKU</Th><Th>Name</Th><Th>Type</Th><Th>Supplier</Th><Th>Category</Th><Th align="right">Inventory</Th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">No products match these filters.</td></tr>
                )}
                {visible.map((p, i) => (
                  <tr key={i} className="border-b border-brand-border last:border-0 hover:bg-brand-surface2/40">
                    <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink">{p.sku}</td>
                    <td className="px-4 py-2.5 text-sm text-ink">{p.name || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${p.type === 'Bundle' ? 'bg-primary/10 text-primary' : 'bg-brand-surface2 text-ink-muted'}`}>
                        {p.type}
                      </span>
                      {p.discontinued && <span className="ml-1 font-mono text-[9px] text-danger uppercase">disc.</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{p.supplier || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{p.category || '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {p.inventory === null
                        ? <span className="font-mono text-[11px] text-ink-dim italic">No stock inventory available</span>
                        : <span className={`font-mono text-sm font-semibold ${p.inventory > 0 ? 'text-ink' : 'text-danger'}`}>{p.inventory.toLocaleString()}</span>}
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
  return <th className={`px-4 py-3 font-mono text-[9px] text-ink-dim uppercase tracking-widest text-${align}`}>{children}</th>
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="accent-primary w-3.5 h-3.5" />
      <span className="font-mono text-[11px] text-ink-muted">{label}</span>
    </label>
  )
}
