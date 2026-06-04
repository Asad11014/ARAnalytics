import { useState, useEffect, useCallback } from 'react'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'

function fmtToday(iso) {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Build a clean, multi-section CSV of the whole report and trigger a download.
function exportEodCsv({ date, meta, byClient, byCourier, asns }) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = []

  rows.push([`End-of-Day Despatch — ${date}`])
  rows.push([])
  rows.push(['Summary'])
  rows.push(['Orders Despatched', meta.totalOrders])
  rows.push(['Total Parcels', meta.totalParcels])
  rows.push(['Active Clients', meta.activeClients])
  rows.push(['Tracked Consignments (RM/APC/FedEx)', meta.trackedConsignments])
  rows.push(['ASNs Booked In', meta.totalAsns])
  rows.push([])

  rows.push(['Orders Despatched by Client'])
  rows.push(['Client', 'Orders', 'Parcels'])
  byClient.forEach(r => rows.push([r.clientName, r.orders, r.parcels]))
  rows.push([])

  rows.push(['Consignments by Courier'])
  rows.push(['Courier', 'Orders', 'Consignments'])
  byCourier.forEach(r => rows.push([r.courier, r.orders, r.consignments]))
  rows.push([])

  rows.push(['ASNs Booked In Today'])
  rows.push(['ASN Number', 'Client', 'PO Reference', 'Quantity', 'Status'])
  asns.forEach(a => rows.push([a.asnNumber, a.clientName, a.poReference, a.quantity, a.status]))

  const csv  = rows.map(r => r.map(esc).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = `eod-despatch-${date}.csv`
  a.click()
}

export default function EodDespatch() {
  const { warehouseId } = useSession()
  const [byClient,  setByClient]  = useState(null)
  const [byCourier, setByCourier] = useState(null)
  const [asns,      setAsns]      = useState(null)
  const [meta,      setMeta]      = useState(null)
  const [date,      setDate]      = useState(null)
  const [status,    setStatus]    = useState({ msg: '', type: null })
  const [loading,   setLoading]   = useState(false)

  const run = useCallback(async () => {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true)
    try {
      const url = buildReportURL('eod-despatch', { warehouseId })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setByClient(res.byClient || [])
      setByCourier(res.byCourier || [])
      setAsns(res.asns || [])
      setMeta(res.meta || {})
      setDate(res.date || null)
      setStatus({ msg: `${res.meta?.totalOrders ?? 0} orders despatched today`, type: 'success' })
    } catch (e) {
      setStatus({ msg: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [warehouseId])

  useEffect(() => { run() }, [warehouseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const clientColumns = [
    { key: 'clientName', label: 'Client',  render: r => <span className="font-semibold">{r.clientName}</span> },
    { key: 'orders',     label: 'Orders',  align: 'right' },
    { key: 'parcels',    label: 'Parcels', align: 'right' },
  ]

  const courierColumns = [
    { key: 'courier',      label: 'Courier',      render: r => <span className="font-semibold">{r.courier}</span> },
    { key: 'orders',       label: 'Orders',       align: 'right' },
    { key: 'consignments', label: 'Consignments', align: 'right',
      render: r => <span className="font-semibold text-primary">{r.consignments}</span> },
  ]

  const asnColumns = [
    { key: 'asnNumber',   label: 'ASN #',        render: r => <span className="font-mono font-bold text-primary">{r.asnNumber}</span> },
    { key: 'clientName',  label: 'Client',       render: r => <span className="font-semibold">{r.clientName}</span> },
    { key: 'poReference', label: 'PO Reference' },
    { key: 'quantity',    label: 'Qty',          align: 'right' },
    { key: 'status',      label: 'Status' },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">End-of-Day Despatch</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            {date ? fmtToday(date) : 'Today’s despatch activity — orders per client, consignments per courier, and goods-in'}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {meta && (
            <button onClick={() => exportEodCsv({ date, meta, byClient, byCourier, asns })}
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
        <StatusBar message={status.msg} type={status.type} />

        {meta && (
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Orders Despatched" value={meta.totalOrders?.toLocaleString()} />
            <StatCard label="Total Parcels"     value={meta.totalParcels?.toLocaleString()} />
            <StatCard label="Active Clients"    value={meta.activeClients} />
            <StatCard label="Tracked Consignments" value={meta.trackedConsignments?.toLocaleString()} accent="success" />
            <StatCard label="ASNs Booked In"    value={meta.totalAsns} accent={meta.totalAsns > 0 ? 'success' : undefined} />
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* By client */}
          <div className="space-y-2">
            <div className="font-mono text-[9px] text-primary uppercase tracking-widest">▸ Orders Despatched by Client</div>
            {byClient && <SortableTable columns={clientColumns} rows={byClient} emptyMessage="No orders despatched today yet." />}
          </div>

          {/* By courier */}
          <div className="space-y-2">
            <div className="font-mono text-[9px] text-primary uppercase tracking-widest">▸ Consignments by Courier</div>
            {byCourier && <SortableTable columns={courierColumns} rows={byCourier} emptyMessage="No consignments today yet." />}
            <p className="font-mono text-[10px] text-ink-dim leading-relaxed pt-1">
              Consignments = total parcels. Royal Mail is typically 1 per order; APC and FedEx
              may split an order across several parcels. Only these three carriers are tracked.
              {meta?.otherOrders > 0 && ` ${meta.otherOrders} order${meta.otherOrders !== 1 ? 's' : ''} on other couriers excluded.`}
            </p>
          </div>
        </div>

        {/* ASNs booked in today */}
        <div className="space-y-2">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest">
            ▸ ASNs Booked In Today {meta && `(${meta.totalAsns})`}
          </div>
          {asns && <SortableTable columns={asnColumns} rows={asns} emptyMessage="No ASNs booked in today yet." />}
        </div>
      </div>
    </div>
  )
}
