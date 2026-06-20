import { useState, useEffect } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'

const FONTS = { mono: '"DM Mono", monospace', sans: 'Montserrat, sans-serif' }
const fmtGBP = v => `£${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

// Format a Date as YYYY-MM-DD using LOCAL time (not UTC) to avoid BST/timezone shifts
const fmtLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

// Generate the last N months as selectable billing periods
function buildPeriods(n = 12) {
  const now = new Date()
  const periods = []
  for (let i = 0; i < n; i++) {
    const year  = now.getMonth() - i < 0 ? now.getFullYear() - 1 : now.getFullYear()
    const month = ((now.getMonth() - i) + 12) % 12
    const first = new Date(year, month, 1)
    const last  = i === 0 ? now : new Date(year, month + 1, 0)
    const yymm  = `${year}-${String(month + 1).padStart(2, '0')}`
    periods.push({
      label:     first.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
      from:      fmtLocal(first),
      to:        fmtLocal(last),
      yymm,
      isCurrent: i === 0,
    })
  }
  return periods
}

// ── Warehouse view ────────────────────────────────────────────────────────────

const WAREHOUSE_COLS = [
  { key: 'name',    label: 'Client' },
  { key: 'picking', label: 'Picking',       align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.picking)}</span> },
  { key: 'postage', label: 'Postage',       align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.postage)}</span> },
  { key: 'storage', label: 'Storage',       align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.storage)}</span> },
  { key: 'goodsIn', label: 'Goods In',      align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.goodsIn)}</span> },
  { key: 'returns', label: 'Returns',       align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.returns)}</span> },
  { key: 'other',   label: 'Other',         align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.other)}</span>   },
  { key: 'revenue', label: 'Total Revenue', align: 'right', render: r => <span className="font-semibold text-primary">{fmtGBP(r.revenue)}</span> },
]

function WarehouseView({ rows, meta, status, loading, onRun, onExport }) {
  const PERIODS = buildPeriods(12)
  const [selectedPeriod, setSelectedPeriod] = useState(PERIODS[0])

  const chartOpts = rows?.length ? {
    chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, stacked: true, animations: { speed: 400 } },
    plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '60%' } },
    colors: ['#2D4270', '#c9a24b', '#16a34a', '#6b7280', '#e03355', '#9ca3af'],
    legend: { position: 'bottom', fontFamily: FONTS.mono, fontSize: '11px' },
    xaxis: {
      categories: rows.map(r => r.name),
      axisBorder: { show: false }, axisTicks: { show: false },
      labels: { style: { colors: '#6b7280', fontFamily: FONTS.mono, fontSize: '11px' }, formatter: v => `£${Number(v).toLocaleString()}` }
    },
    yaxis: { labels: { style: { colors: '#1a1c2e', fontFamily: FONTS.sans, fontSize: '12px', fontWeight: 600 } } },
    grid: { borderColor: '#d8dbe8', strokeDashArray: 4, yaxis: { lines: { show: false } } },
    dataLabels: { enabled: false },
    tooltip: { theme: 'light', style: { fontFamily: FONTS.mono, fontSize: '12px' }, y: { formatter: v => fmtGBP(v) } },
  } : null

  return (
    <>
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Revenue Breakdown</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Revenue breakdown per client by billing period</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={selectedPeriod.yymm}
            onChange={e => setSelectedPeriod(PERIODS.find(p => p.yymm === e.target.value) || PERIODS[0])}
            className="bg-brand-bg border border-brand-border rounded text-ink font-mono text-[11px] px-2 py-1.5 focus:outline-none focus:border-primary"
          >
            {PERIODS.map(p => (
              <option key={p.yymm} value={p.yymm}>{p.label}{p.isCurrent ? ' (current)' : ''}</option>
            ))}
          </select>
          {rows && <button onClick={onExport}
            className="border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">Export CSV</button>}
          <button onClick={() => onRun(selectedPeriod.from, selectedPeriod.to)} disabled={loading}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-4 py-2 transition-colors disabled:opacity-50">
            {loading ? '⟳ Loading…' : '▶ Load Report'}
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <StatusBar message={status.msg} type={status.type} />
        {meta && rows && (
          <>
            <div className="flex gap-3 flex-wrap">
              <StatCard label="Total Revenue" value={fmtGBP(meta.totalRevenue)} accent="primary" />
              <StatCard label="Active Clients" value={meta.totalClients} />
              {meta.period && <StatCard label="Period" value={meta.period} />}
            </div>
            {chartOpts && rows.length > 0 && (
              <div className="bg-brand-surface border border-brand-border rounded-lg p-4">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Revenue by Client</div>
                <ReactApexChart type="bar"
                  series={[
                    { name: 'Picking',  data: rows.map(r => r.picking)  },
                    { name: 'Postage',  data: rows.map(r => r.postage)  },
                    { name: 'Storage',  data: rows.map(r => r.storage)  },
                    { name: 'Goods In', data: rows.map(r => r.goodsIn)  },
                    { name: 'Returns',  data: rows.map(r => r.returns)  },
                    { name: 'Other',    data: rows.map(r => r.other)    },
                  ]}
                  options={chartOpts}
                  height={Math.min(Math.max(220, rows.length * 44 + 60), 400)}
                />
              </div>
            )}
            <SortableTable columns={WAREHOUSE_COLS} rows={rows} emptyMessage="No billing activity for this period." />
          </>
        )}
      </div>
    </>
  )
}

// ── Client view ───────────────────────────────────────────────────────────────

// Line items in the same order/wording as the client invoice.
const INVOICE_LINES = [
  { key: 'pickingCost',      label: 'Picking Cost' },
  { key: 'postageCost',      label: 'Postage Cost' },
  { key: 'vatFreePostage',   label: 'Postage Cost (VAT-free)', vatFree: true },
  { key: 'reworkCost',       label: 'Rework Cost' },
  { key: 'packagingCost',    label: 'Packaging Cost' },
  { key: 'genericAdminCost', label: 'Generic Admin Cost' },
  { key: 'invoiceAdminCost', label: 'Invoice Admin Cost' },
  { key: 'goodsInCost',      label: 'GoodsIn Cost' },
  { key: 'returnsCost',      label: 'Returns Cost' },
  { key: 'collectionsCost',  label: 'Collections Cost' },
  { key: 'storageCost',      label: 'Storage Cost' },
]

// Plain 2dp number (invoice shows amounts under an "Amount GBP" header, no £).
const fmtNum = v => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Th({ children, align = 'left' }) {
  return <th className={`px-5 py-3 font-mono text-[9px] text-ink-dim uppercase tracking-widest text-${align}`}>{children}</th>
}
function TotalRow({ label, value, strong }) {
  return (
    <div className="w-full max-w-xs flex items-center justify-between">
      <span className={`font-sans ${strong ? 'text-[15px] font-bold text-ink' : 'text-sm text-ink-muted'}`}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? 'text-xl font-bold text-primary' : 'text-sm text-ink'}`}>{value}</span>
    </div>
  )
}

function ClientView({ status, loading, invoiceTotals, onLoadPeriod }) {
  const PERIODS = buildPeriods(12)

  // Clients only see confirmed invoices — exclude the current (unconfirmed) month.
  const confirmedPeriods = PERIODS.filter(p => !p.isCurrent)

  const periodColumns = [
    { key: 'label', label: 'Billing Period', render: r => (
        <span className="font-sans font-medium text-ink">{r.label}</span>
      )
    },
    { key: 'from',  label: 'Start Date', render: r => <span className="font-mono text-xs text-ink-muted">{fmtDate(r.from)}</span> },
    { key: 'to',    label: 'End Date',   render: r => <span className="font-mono text-xs text-ink-muted">{fmtDate(r.to)}</span>   },
    { key: 'total', label: 'Net Total',  align: 'right', render: r => {
        const val = invoiceTotals[r.yymm]
        return val != null
          ? <span className="font-mono text-xs font-semibold text-ink">{fmtGBP(val)}</span>
          : <span className="font-mono text-xs text-ink-dim">—</span>
      }
    },
    { key: 'action', label: '', align: 'right',
      render: r => (
        <button onClick={() => onLoadPeriod(r.from, r.to, r.label)} disabled={loading}
          className="font-mono text-[11px] px-3 py-1 rounded border border-brand-border text-ink-muted hover:border-primary hover:text-primary transition-colors disabled:opacity-40">
          View →
        </button>
      )
    },
  ]

  return (
    <>
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Cost Breakdown</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Select a billing period to view your cost breakdown</div>
        </div>
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <StatusBar message={status.msg} type={status.type} />
        <div className="bg-brand-surface border border-brand-border rounded-lg p-4">
          <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Billing Periods</div>
          <SortableTable columns={periodColumns} rows={confirmedPeriods} emptyMessage="No periods available." />
        </div>
      </div>
    </>
  )
}

function ClientBreakdown({ breakdown, meta, period, status, loading, apiLimited, onBack, onExport }) {
  const visibleLines = breakdown ? INVOICE_LINES.filter(l => (breakdown[l.key] || 0) > 0) : []

  return (
    <>
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack}
            className="font-mono text-[11px] text-ink-muted hover:text-primary transition-colors flex-shrink-0">
            ← Back
          </button>
          <div className="w-px h-4 bg-brand-border flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-sans font-bold text-[15px] text-ink">Cost Breakdown</div>
            <div className="font-mono text-[11px] text-ink-muted hidden sm:block truncate">{period?.label}</div>
          </div>
        </div>
        {breakdown && (
          <button onClick={onExport}
            className="flex-shrink-0 border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">
            Export CSV
          </button>
        )}
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        <StatusBar message={status.msg} type={status.type} />

        {loading && !breakdown && (
          <div className="bg-brand-surface border border-brand-border rounded-lg p-8 text-center">
            <div className="w-6 h-6 border-2 border-brand-border border-t-primary rounded-full animate-spin mx-auto mb-3" />
            <div className="font-mono text-xs text-ink-muted">Fetching billing data…</div>
          </div>
        )}

        {apiLimited && !loading && (
          <div className="bg-brand-surface border border-brand-border rounded-lg p-8 text-center space-y-2">
            <div className="text-3xl">🧾</div>
            <div className="font-sans font-bold text-ink">Invoice data not available</div>
            <div className="font-mono text-xs text-ink-muted max-w-sm mx-auto">
              Past invoices have already been confirmed and issued. The Mintsoft API only exposes live accruals for the current month. Contact your warehouse for PDF copies of past invoices.
            </div>
          </div>
        )}

        {breakdown && meta && (
          <div className="bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
            {/* Invoice-style header */}
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-brand-border">
              <div>
                <div className="font-sans font-extrabold text-xl text-ink tracking-tight">COST BREAKDOWN</div>
                <div className="font-mono text-[11px] text-ink-muted mt-1">Reference · {period?.label || meta.period}</div>
              </div>
              <div className="text-right font-sans text-[13px] text-ink-muted leading-snug">
                <div className="font-bold text-ink">Premium Fulfilment</div>
                <div>Unit 27, The Metro Centre</div>
                <div>Dwight Road, Watford, WD18 9SB</div>
              </div>
            </div>

            {/* Line items */}
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[640px]">
                <thead>
                  <tr className="border-b border-brand-border">
                    <Th>Description</Th>
                    <Th align="right">Quantity</Th>
                    <Th align="right">Unit Price</Th>
                    <Th align="right">VAT</Th>
                    <Th align="right">Amount GBP</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-6 text-center font-mono text-xs text-ink-muted">No charges for this period.</td></tr>
                  )}
                  {visibleLines.map(l => (
                    <tr key={l.key} className="border-b border-brand-border last:border-0">
                      <td className="px-5 py-3 font-sans text-sm text-ink">{l.label}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-ink-muted tabular-nums">1.00</td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-ink tabular-nums">{fmtNum(breakdown[l.key])}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-ink-muted">{l.vatFree ? 'VAT-free' : '20%'}</td>
                      <td className="px-5 py-3 text-right font-mono text-sm text-ink font-semibold tabular-nums">{fmtNum(breakdown[l.key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="px-5 sm:px-6 py-4 flex flex-col items-end gap-1.5">
              <TotalRow label="Subtotal" value={fmtNum(meta.subtotal)} />
              <TotalRow label="TOTAL VAT 20%" value={fmtNum(meta.vat)} />
              <div className="w-full max-w-xs border-t border-brand-border pt-2 mt-1">
                <TotalRow label="TOTAL GBP" value={fmtNum(meta.grand)} strong />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export default function Profitability() {
  const { warehouseId, session } = useSession()
  const [mode,          setMode]         = useState('periods') // 'periods' | 'breakdown'
  const [period,        setPeriod]       = useState(null)       // { from, to, label }
  const [data,          setData]         = useState(null)
  const [apiLimited,    setApiLimited]   = useState(false)
  const [status,        setStatus]       = useState({ msg: '', type: null })
  const [loading,       setLoading]      = useState(false)
  const [invoiceTotals, setInvoiceTotals] = useState({})

  // Pre-fetch all invoice totals for the periods table (client users only)
  useEffect(() => {
    if (session?.isWarehouse || !warehouseId) return
    const url = buildReportURL('profitability', { warehouseId, mode: 'totals' })
    fetchReportSSE(url, () => {})
      .then(res => { if (res?.totals) setInvoiceTotals(res.totals) })
      .catch(() => {})
  }, [session?.isWarehouse, warehouseId])

  async function runWarehouse(from, to) {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setData(null)
    try {
      const url = buildReportURL('profitability', { warehouseId, ...(from ? { from, to } : {}) })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setData(res)
      setStatus({ msg: `${(res.rows || []).length} clients with billing activity`, type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }

  async function loadPeriod(from, to, label) {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setPeriod({ from, to, label })
    setMode('breakdown')
    setData(null)
    setApiLimited(false)
    setLoading(true)
    setStatus({ msg: '', type: null })
    try {
      const url = buildReportURL('profitability', { warehouseId, from, to })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setData(res)
      setApiLimited(!!res.apiLimited)
      setStatus({ msg: res.apiLimited ? '' : 'Billing data loaded', type: res.apiLimited ? null : 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }

  function exportClientCSV() {
    if (!data?.breakdown) return
    const b = data.breakdown
    const rows = [
      ...INVOICE_LINES.filter(l => (b[l.key] || 0) > 0).map(l => ({
        description: l.label, vat: l.vatFree ? 'VAT-free' : '20%', amount: b[l.key],
      })),
      { description: 'Subtotal',       vat: '', amount: b.subtotal },
      { description: 'TOTAL VAT 20%',  vat: '', amount: b.vat },
      { description: 'TOTAL GBP',      vat: '', amount: b.grand },
    ]
    const cols = [
      { key: 'description', label: 'Description' },
      { key: 'vat',         label: 'VAT' },
      { key: 'amount',      label: 'Amount GBP', csvValue: r => Number(r.amount || 0).toFixed(2) },
    ]
    exportCSV(`cost-breakdown-${period?.from}.csv`, cols, rows)
  }

  if (!session?.isWarehouse) {
    if (mode === 'breakdown') {
      return (
        <div className="flex-1 overflow-y-auto">
          <ClientBreakdown
            breakdown={data?.breakdown}
            meta={data?.meta}
            period={period}
            status={status}
            loading={loading}
            apiLimited={apiLimited}
            onBack={() => { setMode('periods'); setData(null); setApiLimited(false); setStatus({ msg: '', type: null }) }}
            onExport={exportClientCSV}
          />
        </div>
      )
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <ClientView status={status} loading={loading} invoiceTotals={invoiceTotals} onLoadPeriod={loadPeriod} />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <WarehouseView
        rows={data?.rows}
        meta={data?.meta}
        status={status}
        loading={loading}
        onRun={runWarehouse}
        onExport={() => exportCSV('profitability.csv', WAREHOUSE_COLS, data?.rows || [])}
      />
    </div>
  )
}
