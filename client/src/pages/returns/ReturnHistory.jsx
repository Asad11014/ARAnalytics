import { useState, useEffect, useCallback, Fragment } from 'react'
import StatusBar from '../../components/StatusBar'
import { StatusBadge } from '../../lib/returnStatus'

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const fmtItems = items => Array.isArray(items)
  ? items.map(i => `${i.sku} ×${i.quantity}`).join(', ')
  : (items || '')
const fmtAddress = a => a && typeof a === 'object'
  ? [a.line1, a.line2, a.line3, a.town, a.county, a.postcode].filter(Boolean).join(', ')
  : (a || '')

export default function ReturnHistory() {
  const [returns, setReturns] = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/returns')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load returns')
      setReturns(data.returns || [])
      setStatus({ msg: `${(data.returns || []).length} returns`, type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Return History</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">All your return requests and their status</div>
        </div>
        <button onClick={load} disabled={loading}
          className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-1.5 transition-colors disabled:opacity-50">
          {loading ? '⟳ Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="p-4 sm:p-7 space-y-4">
        <StatusBar message={status.msg} type={status.type} />
        {returns && (
          <div className="bg-brand-surface border border-brand-border rounded-lg overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead>
                <tr className="border-b border-brand-border">
                  <Th>Reference</Th><Th>Customer</Th><Th>Reason</Th><Th>Requested</Th><Th>Status</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {returns.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">No returns booked yet.</td></tr>
                )}
                {returns.map(r => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-brand-border last:border-0 hover:bg-brand-surface2/40 cursor-pointer"
                      onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink">{r.reference || `#${r.id}`}</td>
                      <td className="px-4 py-2.5 text-sm text-ink">{r.customerName || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted">{r.formData?.reason || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{fmtDate(r.createdAt)}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-right font-mono text-[10px] text-ink-dim">{open === r.id ? '▲' : '▼'}</td>
                    </tr>
                    {open === r.id && (
                      <tr className="bg-brand-surface2/30">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 font-mono text-[11px]">
                            <Detail label="Items" value={fmtItems(r.formData?.items)} />
                            <Detail label="Collection address" value={fmtAddress(r.formData?.address)} />
                            <Detail label="Preferred date" value={r.formData?.preferredCollectionDate} />
                            <Detail label="Notes" value={r.formData?.notes} />
                            {/* Booking info appears once the warehouse actions it */}
                            {r.bookingData?.courier && <Detail label="Courier" value={r.bookingData.courier} highlight />}
                            {r.bookingData?.trackingNumber && <Detail label="Tracking" value={r.bookingData.trackingNumber} highlight />}
                            {r.bookingData?.labelFile && (
                              <div className="flex gap-2">
                                <span className="text-ink-dim">Shipping label:</span>
                                <a href={r.bookingData.labelFile} download={r.bookingData.labelFilename || `return-${r.id}-label`}
                                  className="text-primary font-semibold underline">↓ Download</a>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Th({ children }) { return <th className="px-4 py-3 font-mono text-[9px] text-ink-dim uppercase tracking-widest">{children}</th> }
function Detail({ label, value, highlight }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-ink-dim">{label}:</span>
      <span className={highlight ? 'text-primary font-semibold' : 'text-ink'}>{value}</span>
    </div>
  )
}
