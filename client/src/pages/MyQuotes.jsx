// ─── client/src/pages/MyQuotes.jsx ───────────────────────────────────────────
// Quote history. Clients see only their own quotes at client-facing prices.
// Warehouse users see all quotes with both base cost and client price.

import { useEffect, useState } from 'react'
import { useSession } from '../context/SessionContext'

const ZONE_LABELS   = { europe: 'Europe', wz1: 'World Zone 1', wz2: 'World Zone 2' }
const SERVICE_LABELS = { standard: 'Standard', tracked: 'Tracked & Signed' }
const CARRIER_LABELS = { royal_mail: 'Royal Mail', inxpress: 'Inxpress', freight: 'Freight' }

function fmtGBP(v) {
  if (v == null) return '—'
  return `£${Number(v).toFixed(2)}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDims(q) {
  return `${q.lengthCm} × ${q.widthCm} × ${q.depthCm} cm`
}

function fmtWeight(g) {
  if (g == null) return '—'
  return g >= 1000
    ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 2).replace(/\.?0+$/, '')} kg`
    : `${g} g`
}

function Badge({ label, color }) {
  const colors = {
    green:   'bg-[#e9f5eb] text-[#15803d]',
    blue:    'bg-primary/10 text-primary',
    neutral: 'bg-brand-surface2 text-ink-muted',
    amber:   'bg-warning/10 text-warning',
  }
  return (
    <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${colors[color] || colors.neutral}`}>
      {label}
    </span>
  )
}

export default function MyQuotes() {
  const { session } = useSession()
  const isWarehouse = session?.isWarehouse ?? false

  const [quotes,  setQuotes]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState('')

  useEffect(() => {
    fetch('/api/quotes')
      .then(r => r.json())
      .then(d => { setQuotes(d.quotes || []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const filtered = quotes.filter(q => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      q.reference?.toLowerCase().includes(s) ||
      q.country?.toLowerCase().includes(s) ||
      q.formatName?.toLowerCase().includes(s) ||
      q.createdBy?.toLowerCase().includes(s)
    )
  })

  return (
    <div className="flex-1 overflow-y-auto">

      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-4">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">
            {isWarehouse ? 'All Quotes' : 'My Quotes'}
          </div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            {isWarehouse
              ? 'All quotes from all users — base cost and client price shown'
              : 'Your saved shipping quotes'}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search quotes…"
            className="bg-brand-bg border border-brand-border rounded px-3 py-1.5 font-mono text-xs text-ink placeholder-ink-dim focus:outline-none focus:border-primary transition-colors w-44 sm:w-56"
          />
        </div>
      </header>

      <div className="p-4 sm:p-7">

        {loading && (
          <div className="flex items-center justify-center h-48 text-ink-muted font-mono text-sm">
            Loading…
          </div>
        )}

        {error && (
          <div className="font-mono text-sm text-danger bg-danger/10 border border-danger/20 rounded px-4 py-3">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="text-4xl mb-3">📋</div>
            <div className="font-sans font-semibold text-ink mb-1">
              {search ? 'No quotes match your search' : 'No quotes yet'}
            </div>
            <div className="font-mono text-xs text-ink-muted">
              {search ? 'Try a different search term.' : 'Create a quote from the Quotations page.'}
            </div>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            {/* Summary strip */}
            <div className="flex items-center gap-4 mb-4">
              <span className="font-mono text-[10px] text-ink-muted">{filtered.length} quote{filtered.length !== 1 ? 's' : ''}</span>
              {isWarehouse && (
                <span className="font-mono text-[10px] text-ink-muted">
                  Total client value:{' '}
                  <span className="text-ink font-semibold">
                    {fmtGBP(filtered.reduce((s, q) => s + (q.totalClient || 0), 0))}
                  </span>
                </span>
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-brand-border">
                    <Th>Reference</Th>
                    <Th>Date</Th>
                    {isWarehouse && <Th>Created By</Th>}
                    <Th>Destination</Th>
                    <Th>Package</Th>
                    <Th>Service</Th>
                    {isWarehouse && <Th align="right">RM Cost</Th>}
                    <Th align="right">{isWarehouse ? 'Client Price' : 'Price'}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(q => (
                    <tr key={q.id} className="border-b border-brand-border last:border-0 hover:bg-brand-surface2 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-bold text-primary">{q.reference || `#${q.id}`}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted whitespace-nowrap">
                        {fmtDate(q.createdAt)}
                      </td>
                      {isWarehouse && (
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs text-ink">{q.createdBy}</div>
                          {q.isClient && <Badge label="Client" color="blue" />}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-ink">{q.country}</div>
                        <div className="font-mono text-[9px] text-ink-dim">{ZONE_LABELS[q.zone]}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-ink">{q.formatName || '—'}</div>
                        <div className="font-mono text-[9px] text-ink-dim">
                          {fmtDims(q)} · {fmtWeight(q.weightG)}
                          {q.quantity > 1 ? ` · ×${q.quantity}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {q.service ? (
                          <Badge
                            label={SERVICE_LABELS[q.service] || q.service}
                            color={q.service === 'tracked' ? 'blue' : 'neutral'}
                          />
                        ) : '—'}
                      </td>
                      {isWarehouse && (
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-xs text-ink-muted">{fmtGBP(q.totalBase)}</span>
                          {q.quantity > 1 && (
                            <div className="font-mono text-[9px] text-ink-dim">{fmtGBP(q.baseRate)} ea</div>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-xs font-bold text-ink">{fmtGBP(q.totalClient)}</span>
                        {q.quantity > 1 && (
                          <div className="font-mono text-[9px] text-ink-dim">{fmtGBP(q.clientRate)} ea</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.map(q => (
                <div key={q.id} className="bg-brand-surface border border-brand-border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs font-bold text-primary">{q.reference || `#${q.id}`}</div>
                      <div className="font-mono text-[10px] text-ink-muted">{fmtDate(q.createdAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-sans font-bold text-base text-ink">{fmtGBP(q.totalClient)}</div>
                      {isWarehouse && (
                        <div className="font-mono text-[10px] text-ink-dim">RM: {fmtGBP(q.totalBase)}</div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
                    <span className="text-ink-muted">Destination</span>
                    <span className="text-ink font-semibold">{q.country}</span>
                    <span className="text-ink-muted">Format</span>
                    <span className="text-ink">{q.formatName || '—'}</span>
                    <span className="text-ink-muted">Weight</span>
                    <span className="text-ink">{fmtWeight(q.weightG)}</span>
                    <span className="text-ink-muted">Qty</span>
                    <span className="text-ink">{q.quantity}</span>
                    {isWarehouse && (
                      <>
                        <span className="text-ink-muted">Created by</span>
                        <span className="text-ink">{q.createdBy}</span>
                      </>
                    )}
                  </div>

                  {q.service && (
                    <Badge
                      label={SERVICE_LABELS[q.service] || q.service}
                      color={q.service === 'tracked' ? 'blue' : 'neutral'}
                    />
                  )}
                </div>
              ))}
            </div>
          </>
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
