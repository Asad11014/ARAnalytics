import { useState, useCallback } from 'react'
import StatusBar from '../../components/StatusBar'

const inputCls = 'bg-brand-bg border border-brand-border rounded px-3 py-2 font-mono text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-primary transition-colors'

function Steps({ step }) {
  const labels = ['Find order', 'Select items', 'Collection']
  return (
    <div className="flex items-center gap-2 mb-6">
      {labels.map((l, i) => {
        const n = i + 1, active = step === n, done = step > n
        return (
          <div key={l} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-[11px] font-bold
              ${active ? 'bg-primary text-white' : done ? 'bg-success text-white' : 'bg-brand-surface2 text-ink-dim'}`}>
              {done ? '✓' : n}
            </div>
            <span className={`font-mono text-[11px] ${active ? 'text-ink font-bold' : 'text-ink-muted'}`}>{l}</span>
            {i < labels.length - 1 && <span className="text-ink-dim mx-1">→</span>}
          </div>
        )
      })}
    </div>
  )
}

export default function BookReturn() {
  const [step, setStep] = useState(1)
  const [status, setStatus] = useState({ msg: '', type: null })

  // Stage 1 — search
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)

  // Stage 2 — detail + item selection
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel]         = useState({}) // sku -> { checked, qty }

  // Stage 3 — collection
  const [collectionDate, setCollectionDate] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)

  const search = useCallback(async (e) => {
    e?.preventDefault()
    if (query.trim().length < 2) { setStatus({ msg: 'Enter at least 2 characters.', type: 'error' }); return }
    setSearching(true); setStatus({ msg: '', type: null })
    try {
      const res = await fetch(`/api/orders/search?q=${encodeURIComponent(query.trim())}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Search failed')
      setResults(data.orders || [])
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setSearching(false) }
  }, [query])

  const pickOrder = useCallback(async (order) => {
    setLoading(true); setStatus({ msg: '', type: null })
    try {
      const res = await fetch(`/api/orders/return-detail?id=${order.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load order')
      setDetail(data)
      // default-select all items at their ordered quantity
      const initial = {}
      data.items.forEach(it => { initial[it.sku] = { checked: true, qty: it.quantity } })
      setSel(initial)
      setStep(2)
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }, [])

  const toggle = (sku) => setSel(s => ({ ...s, [sku]: { ...s[sku], checked: !s[sku].checked } }))
  const setQty = (sku, qty, max) => setSel(s => ({ ...s, [sku]: { ...s[sku], qty: Math.max(1, Math.min(max, parseInt(qty) || 1)) } }))

  const chosenItems = detail ? detail.items.filter(it => sel[it.sku]?.checked) : []

  async function submit() {
    if (!collectionDate) { setStatus({ msg: 'Please choose a preferred collection date.', type: 'error' }); return }
    setSubmitting(true); setStatus({ msg: 'Submitting return request…', type: 'loading' })
    try {
      const payload = {
        reference:    detail.order.orderNumber,
        orderId:      detail.order.id,
        customerName: detail.order.customerName,
        customerEmail: detail.order.email,
        customerPhone: detail.order.phone,
        address:      detail.order.address,
        items:        chosenItems.map(it => ({ sku: it.sku, name: it.name, quantity: sel[it.sku].qty })),
        preferredCollectionDate: collectionDate,
        notes,
      }
      const res = await fetch('/api/returns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit')
      setDone(data.return)
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setSubmitting(false) }
  }

  function reset() {
    setStep(1); setQuery(''); setResults(null); setDetail(null); setSel({})
    setCollectionDate(''); setNotes(''); setDone(null); setStatus({ msg: '', type: null })
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Book a Return</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Find the order, choose items, and request a collection</div>
        </div>
      </header>

      <div className="p-4 sm:p-7 max-w-3xl">
        {done ? (
          <div className="bg-brand-surface border border-brand-border rounded-lg p-8 text-center">
            <div className="text-5xl mb-4">✅</div>
            <div className="font-sans font-bold text-lg text-ink mb-1">Return request submitted</div>
            <p className="font-mono text-xs text-ink-muted mb-4 leading-relaxed max-w-md mx-auto">
              Reference <strong className="text-ink">#{done.id}</strong> for order <strong className="text-ink">{done.reference}</strong> —
              our warehouse team has been notified and will book the collection. Track it under Return History.
            </p>
            <span className="font-mono text-[10px] uppercase tracking-widest text-gold bg-gold/10 border border-gold/30 rounded px-3 py-1">Status: pending</span>
            <div className="mt-6"><button onClick={reset} className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-2">Book another return</button></div>
          </div>
        ) : (
          <>
            <Steps step={step} />
            <StatusBar message={status.msg} type={status.type} />

            {/* ── Stage 1: find order ── */}
            {step === 1 && (
              <div className="space-y-4">
                <form onSubmit={search} className="bg-brand-surface border border-brand-border rounded-lg p-5">
                  <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Which order is the return for?</div>
                  <div className="flex gap-2">
                    <input className={`${inputCls} flex-1`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Order number or reference (e.g. IN84815)" autoFocus />
                    <button type="submit" disabled={searching} className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-5 transition-colors disabled:opacity-50">
                      {searching ? '…' : 'Search'}
                    </button>
                  </div>
                </form>

                {results && (
                  <div className="bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
                    {results.length === 0 ? (
                      <div className="px-4 py-8 text-center font-mono text-xs text-ink-muted">No matching orders found. Check the number and try again.</div>
                    ) : (
                      <>
                        <div className="px-4 py-2 border-b border-brand-border font-mono text-[10px] text-ink-muted uppercase tracking-wide">{results.length} match{results.length !== 1 ? 'es' : ''} — select the correct order</div>
                        {results.map(o => (
                          <button key={o.id} onClick={() => pickOrder(o)} disabled={loading}
                            className="w-full text-left px-4 py-3 border-b border-brand-border last:border-0 hover:bg-brand-surface2/50 transition-colors flex items-center justify-between gap-3 disabled:opacity-50">
                            <div className="min-w-0">
                              <div className="font-mono text-sm font-bold text-ink">{o.orderNumber}</div>
                              <div className="font-mono text-[11px] text-ink-muted">{o.customerName || '—'} · {o.location || '—'}</div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="font-mono text-[11px] text-ink-muted">{o.orderDate}</div>
                              <div className="font-mono text-[10px] text-ink-dim">{o.status}</div>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Stage 2: select items ── */}
            {step === 2 && detail && (
              <div className="space-y-4">
                <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
                  <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Order {detail.order.orderNumber}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 font-mono text-[12px]">
                    <div><span className="text-ink-dim">Customer: </span><span className="text-ink font-semibold">{detail.order.customerName || '—'}</span></div>
                    <div><span className="text-ink-dim">Contact: </span><span className="text-ink">{[detail.order.email, detail.order.phone].filter(Boolean).join(' · ') || '—'}</span></div>
                    <div className="sm:col-span-2"><span className="text-ink-dim">Address: </span><span className="text-ink">{[detail.order.address.line1, detail.order.address.line2, detail.order.address.town, detail.order.address.postcode].filter(Boolean).join(', ') || '—'}</span></div>
                  </div>
                </div>

                <div className="bg-brand-surface border border-brand-border rounded-lg p-5">
                  <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Select items to return</div>
                  <div className="space-y-1.5">
                    {detail.items.length === 0 && <div className="font-mono text-xs text-ink-muted">No items recorded on this order.</div>}
                    {detail.items.map(it => (
                      <label key={it.sku} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-brand-surface2/40 cursor-pointer">
                        <input type="checkbox" checked={!!sel[it.sku]?.checked} onChange={() => toggle(it.sku)} className="accent-primary w-4 h-4 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs font-bold text-ink">{it.sku}</div>
                          <div className="text-xs text-ink-muted truncate">{it.name || '—'}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-mono text-[10px] text-ink-dim">ordered {it.quantity}</span>
                          <input type="number" min="1" max={it.quantity} disabled={!sel[it.sku]?.checked}
                            value={sel[it.sku]?.qty ?? it.quantity} onChange={e => setQty(it.sku, e.target.value, it.quantity)}
                            className="w-16 bg-brand-bg border border-brand-border rounded px-2 py-1 font-mono text-xs text-ink text-center disabled:opacity-40" />
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between">
                  <button onClick={() => { setStep(1); setDetail(null) }} className="font-mono text-xs text-ink-muted hover:text-ink border border-brand-border rounded px-4 py-2">← Back</button>
                  <button onClick={() => { if (!chosenItems.length) { setStatus({ msg: 'Select at least one item.', type: 'error' }); return } setStatus({ msg: '', type: null }); setStep(3) }}
                    className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-5 py-2">Continue</button>
                </div>
              </div>
            )}

            {/* ── Stage 3: collection ── */}
            {step === 3 && detail && (
              <div className="space-y-4">
                <div className="bg-brand-surface border border-brand-border rounded-lg p-5 space-y-4">
                  <div className="font-mono text-[9px] text-primary uppercase tracking-widest">▸ Collection details</div>
                  <div className="flex flex-col gap-1.5 max-w-xs">
                    <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Preferred collection date <span className="text-danger">*</span></label>
                    <input type="date" className={inputCls} value={collectionDate} onChange={e => setCollectionDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">Additional details</label>
                    <textarea className={`${inputCls} min-h-[80px]`} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything the warehouse should know…" />
                  </div>
                </div>

                <div className="bg-brand-surface2/40 border border-brand-border rounded-lg p-5">
                  <div className="font-mono text-[9px] text-ink-muted uppercase tracking-widest mb-2">Summary</div>
                  <div className="font-mono text-[12px] space-y-1">
                    <div><span className="text-ink-dim">Order: </span><span className="text-ink font-semibold">{detail.order.orderNumber}</span> · {detail.order.customerName}</div>
                    <div><span className="text-ink-dim">Returning: </span><span className="text-ink">{chosenItems.map(it => `${it.sku} ×${sel[it.sku].qty}`).join(', ')}</span></div>
                  </div>
                </div>

                <div className="flex justify-between">
                  <button onClick={() => setStep(2)} className="font-mono text-xs text-ink-muted hover:text-ink border border-brand-border rounded px-4 py-2">← Back</button>
                  <button onClick={submit} disabled={submitting} className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-6 py-2 disabled:opacity-50">
                    {submitting ? 'Submitting…' : 'Submit Return Request'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
