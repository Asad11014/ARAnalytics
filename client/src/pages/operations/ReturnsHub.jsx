import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import StatusBar from '../../components/StatusBar'
import StatCard  from '../../components/StatCard'
import { StatusBadge, RETURN_STATUSES, RETURN_STATUS_META } from '../../lib/returnStatus'

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const inputCls = 'bg-brand-bg border border-brand-border rounded px-2.5 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-primary'
const COURIERS = ['Royal Mail', 'FedEx', 'APC', 'DPD', 'UPS', 'Other']

// form_data items is an array of { sku, name, quantity }; address is a nested object.
const fmtItems = items => Array.isArray(items)
  ? items.map(i => `${i.sku} ×${i.quantity}`).join(', ')
  : (items || '')
const fmtAddress = a => a && typeof a === 'object'
  ? [a.line1, a.line2, a.line3, a.town, a.county, a.postcode].filter(Boolean).join(', ')
  : (a || '')

function EditPanel({ ret, onSaved }) {
  const [status, setStatus] = useState(ret.status === 'pending' ? 'booked' : ret.status)
  const [b, setB] = useState({
    courier:        ret.bookingData?.courier        || '',
    trackingNumber: ret.bookingData?.trackingNumber || '',
    labelFile:      ret.bookingData?.labelFile      || null, // base64 data URL
    labelFilename:  ret.bookingData?.labelFilename  || '',
  })
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  const set = (k, v) => setB(p => ({ ...p, [k]: v }))

  function onLabelFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    if (f.size > 5 * 1024 * 1024) { setErr('Label file must be under 5 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => setB(p => ({ ...p, labelFile: reader.result, labelFilename: f.name }))
    reader.readAsDataURL(f)
  }

  async function save() {
    setSaving(true); setErr('')
    try {
      const res  = await fetch(`/api/returns/${ret.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, bookingData: b }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update')
      onSaved(data.return)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="px-4 py-4 bg-brand-surface2/40 space-y-3">
      {/* Client-submitted details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 font-mono text-[11px]">
        <Detail label="Items" value={fmtItems(ret.formData?.items)} />
        <Detail label="Reason" value={ret.formData?.reason} />
        <Detail label="Collection address" value={fmtAddress(ret.formData?.address)} />
        <Detail label="Customer contact" value={[ret.formData?.customerEmail, ret.formData?.customerPhone].filter(Boolean).join(' · ')} />
        <Detail label="Preferred date" value={ret.formData?.preferredCollectionDate} />
        <Detail label="Notes from client" value={ret.formData?.notes} />
      </div>

      {/* Warehouse booking */}
      <div className="border-t border-brand-border pt-3">
        <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-2">▸ Book collection</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <L label="Status">
            <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
              {RETURN_STATUSES.map(s => <option key={s} value={s}>{RETURN_STATUS_META[s].label}</option>)}
            </select>
          </L>
          <L label="Courier">
            <select className={inputCls} value={b.courier} onChange={e => set('courier', e.target.value)}>
              <option value="">— select —</option>
              {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </L>
          <L label="Tracking number"><input className={inputCls} value={b.trackingNumber} onChange={e => set('trackingNumber', e.target.value)} /></L>
        </div>
        <div className="mt-3">
          <L label="Courier label (PDF / image)">
            <div className="flex items-center gap-3">
              <input type="file" accept=".pdf,image/*" onChange={onLabelFile}
                className="font-mono text-[11px] text-ink-muted file:mr-3 file:rounded file:border-0 file:bg-primary file:text-white file:px-3 file:py-1.5 file:font-sans file:text-xs file:cursor-pointer" />
              {b.labelFile && (
                <a href={b.labelFile} download={b.labelFilename || `return-${ret.id}-label`}
                  className="font-mono text-[11px] text-primary underline whitespace-nowrap">↓ {b.labelFilename || 'label'}</a>
              )}
            </div>
          </L>
        </div>
        {err && <div className="font-mono text-[11px] text-danger mt-2">{err}</div>}
        <div className="flex justify-end mt-3">
          <button onClick={save} disabled={saving}
            className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-4 py-1.5 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save & Update Status'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReturnsHub() {
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
      setStatus({ msg: '', type: null })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const onSaved = useCallback((updated) => {
    setReturns(rs => rs.map(r => r.id === updated.id ? { ...r, ...updated } : r))
    setOpen(null)
  }, [])

  const stats = useMemo(() => {
    if (!returns) return null
    return {
      actionRequired: returns.filter(r => r.status === 'pending').length,
      booked:         returns.filter(r => r.status === 'booked').length,
      total:          returns.length,
    }
  }, [returns])

  // Action-required (pending) first, then by most recent.
  const sorted = useMemo(() => {
    if (!returns) return null
    return [...returns].sort((a, b) =>
      (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)
      || new Date(b.createdAt) - new Date(a.createdAt))
  }, [returns])

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Returns Hub</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Client return requests — book collections and update status</div>
        </div>
        <button onClick={load} disabled={loading}
          className="bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-4 py-1.5 transition-colors disabled:opacity-50">
          {loading ? '⟳ Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <StatusBar message={status.msg} type={status.type} />

        {stats && (
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Action Required" value={stats.actionRequired} accent={stats.actionRequired > 0 ? 'warning' : undefined} />
            <StatCard label="Booked"          value={stats.booked} accent="success" />
            <StatCard label="Total Returns"   value={stats.total} />
          </div>
        )}

        {sorted && (
          <div className="bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-brand-border">
                  <Th>Reference</Th><Th>Client</Th><Th>Customer</Th><Th>Requested</Th><Th>Status</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">No return requests yet.</td></tr>
                )}
                {sorted.map(r => (
                  <Fragment key={r.id}>
                    <tr
                      className={`border-b border-brand-border last:border-0 cursor-pointer hover:bg-brand-surface2/40 ${r.status === 'pending' ? 'bg-gold/5' : ''}`}
                      onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink">{r.reference || `#${r.id}`}</td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted">{r.clientNameResolved || r.clientId || '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-ink">{r.customerName || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{fmtDate(r.createdAt)}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-right font-mono text-[10px] text-ink-dim">{open === r.id ? '▲ close' : '▼ action'}</td>
                    </tr>
                    {open === r.id && (
                      <tr><td colSpan={6} className="p-0"><EditPanel ret={r} onSaved={onSaved} /></td></tr>
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
function L({ label, children }) {
  return <div className="flex flex-col gap-1"><label className="font-mono text-[9px] text-ink-muted uppercase tracking-wide">{label}</label>{children}</div>
}
function Detail({ label, value }) {
  if (!value) return null
  return <div className="flex gap-2"><span className="text-ink-dim">{label}:</span><span className="text-ink">{value}</span></div>
}
