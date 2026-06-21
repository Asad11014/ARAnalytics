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

function EditPanel({ ret, onSaved, onDeleted }) {
  const [status, setStatus] = useState(ret.status === 'pending' ? 'booked' : ret.status)
  const [b, setB] = useState({
    courier:        ret.bookingData?.courier        || '',
    trackingNumber: ret.bookingData?.trackingNumber || '',
    labelFile:      ret.bookingData?.labelFile      || null, // base64 data URL
    labelFilename:  ret.bookingData?.labelFilename  || '',
  })
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err,    setErr]    = useState('')

  async function del() {
    if (!window.confirm(`Delete return ${ret.reference || `#${ret.id}`}? It will move to the Deleted list and the client will no longer see it.`)) return
    setDeleting(true); setErr('')
    try {
      const res  = await fetch(`/api/returns/${ret.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      onDeleted(ret.id)
    } catch (e) { setErr(e.message); setDeleting(false) }
  }

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
        <div className="flex justify-between items-center mt-3">
          <button onClick={del} disabled={deleting || saving}
            className="border border-danger/50 text-danger hover:bg-danger/10 font-sans font-bold text-xs rounded px-3 py-1.5 transition-colors disabled:opacity-50">
            {deleting ? 'Deleting…' : '🗑 Delete return'}
          </button>
          <button onClick={save} disabled={saving || deleting}
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
  const [view,    setView]    = useState('active') // 'active' | 'deleted'

  const deletedView = view === 'deleted'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/returns${deletedView ? '?deleted=true' : ''}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load returns')
      setReturns(data.returns || [])
      setStatus({ msg: '', type: null })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }, [deletedView])

  useEffect(() => { load(); setOpen(null) }, [load])

  const onSaved = useCallback((updated) => {
    setReturns(rs => rs.map(r => r.id === updated.id ? { ...r, ...updated } : r))
    setOpen(null)
  }, [])

  // Soft-deleted: drop from the active list immediately.
  const onDeleted = useCallback((id) => {
    setReturns(rs => rs.filter(r => r.id !== id))
    setOpen(null)
    setStatus({ msg: 'Return moved to Deleted list.', type: 'success' })
  }, [])

  const onRestore = useCallback(async (id) => {
    try {
      const res  = await fetch(`/api/returns/${id}/restore`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to restore')
      setReturns(rs => rs.filter(r => r.id !== id))
      setStatus({ msg: 'Return restored to the active list.', type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
  }, [])

  const stats = useMemo(() => {
    if (!returns) return null
    return {
      actionRequired: returns.filter(r => r.status === 'pending').length,
      booked:         returns.filter(r => r.status === 'booked').length,
      total:          returns.length,
    }
  }, [returns])

  // Active: action-required (pending) first, then most recent. Deleted: most
  // recently deleted first.
  const sorted = useMemo(() => {
    if (!returns) return null
    if (deletedView) return [...returns].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))
    return [...returns].sort((a, b) =>
      (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)
      || new Date(b.createdAt) - new Date(a.createdAt))
  }, [returns, deletedView])

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

        {/* Active / Deleted view toggle */}
        <div className="flex gap-1 bg-brand-surface2/60 border border-brand-border rounded-lg p-1 w-fit">
          <TabBtn active={!deletedView} onClick={() => setView('active')}  label="Active" />
          <TabBtn active={deletedView}  onClick={() => setView('deleted')} label="Deleted" />
        </div>

        {stats && !deletedView && (
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
                  <Th>Reference</Th><Th>Client</Th><Th>Customer</Th>
                  <Th>{deletedView ? 'Deleted' : 'Requested'}</Th><Th>Status</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-ink-muted">
                    {deletedView ? 'No deleted returns.' : 'No return requests yet.'}
                  </td></tr>
                )}
                {sorted.map(r => deletedView ? (
                  <tr key={r.id} className="border-b border-brand-border last:border-0 hover:bg-brand-surface2/40">
                    <td className="px-4 py-2.5 font-mono text-xs font-bold text-ink">{r.reference || `#${r.id}`}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{r.clientNameResolved || r.clientId || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-ink">{r.customerName || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">
                      {fmtDate(r.deletedAt)}{r.deletedBy ? <span className="text-ink-dim"> · {r.deletedBy}</span> : ''}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => onRestore(r.id)}
                        className="border border-primary/50 text-primary hover:bg-primary/10 font-sans font-bold text-[11px] rounded px-3 py-1 transition-colors">
                        ↩ Restore
                      </button>
                    </td>
                  </tr>
                ) : (
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
                      <tr><td colSpan={6} className="p-0"><EditPanel ret={r} onSaved={onSaved} onDeleted={onDeleted} /></td></tr>
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
function TabBtn({ active, onClick, label }) {
  return (
    <button onClick={onClick}
      className={`font-sans font-bold text-xs rounded px-3 py-1.5 transition-colors ${active ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink'}`}>
      {label}
    </button>
  )
}
function L({ label, children }) {
  return <div className="flex flex-col gap-1"><label className="font-mono text-[9px] text-ink-muted uppercase tracking-wide">{label}</label>{children}</div>
}
function Detail({ label, value }) {
  if (!value) return null
  return <div className="flex gap-2"><span className="text-ink-dim">{label}:</span><span className="text-ink">{value}</span></div>
}
