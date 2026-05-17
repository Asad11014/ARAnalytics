import { useState } from 'react'
import ReactApexChart from 'react-apexcharts'
import { useSession }     from '../../context/SessionContext'
import { buildReportURL, exportCSV } from '../../lib/api'
import { fetchReportSSE } from '../../lib/sse'
import StatusBar     from '../../components/StatusBar'
import SortableTable from '../../components/SortableTable'
import StatCard      from '../../components/StatCard'

const FONTS = { mono: '"DM Mono", monospace', sans: 'Syne, sans-serif' }
const fmtGBP = v => `£${Number(v||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Profitability() {
  const { warehouseId } = useSession()
  const [rows,    setRows]    = useState(null)
  const [meta,    setMeta]    = useState(null)
  const [status,  setStatus]  = useState({ msg: '', type: null })
  const [loading, setLoading] = useState(false)

  async function run() {
    if (!warehouseId) { setStatus({ msg: 'Select a warehouse first.', type: 'error' }); return }
    setLoading(true); setRows(null)
    try {
      const url = buildReportURL('profitability', { warehouseId })
      const res = await fetchReportSSE(url, p => setStatus({ msg: p.message, type: 'loading' }))
      setRows(res.rows || []); setMeta(res.meta || {})
      setStatus({ msg: `${(res.rows||[]).length} clients with billing activity`, type: 'success' })
    } catch (e) { setStatus({ msg: e.message, type: 'error' }) }
    finally { setLoading(false) }
  }

  const chartOpts = rows?.length ? {
    chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, stacked: true, animations: { speed: 400 } },
    plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '60%' } },
    colors: ['#1f22ac', '#c79a51', '#16a34a', '#6b7280', '#e03355', '#9ca3af'],
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

  const columns = [
    { key: 'name',     label: 'Client' },
    { key: 'picking',  label: 'Picking',  align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.picking)}</span> },
    { key: 'postage',  label: 'Postage',  align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.postage)}</span> },
    { key: 'storage',  label: 'Storage',  align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.storage)}</span> },
    { key: 'goodsIn',  label: 'Goods In', align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.goodsIn)}</span> },
    { key: 'returns',  label: 'Returns',  align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.returns)}</span> },
    { key: 'other',    label: 'Other',    align: 'right', render: r => <span className="font-mono text-xs">{fmtGBP(r.other)}</span> },
    { key: 'revenue',  label: 'Total Revenue', align: 'right',
      render: r => <span className="font-semibold text-primary">{fmtGBP(r.revenue)}</span>
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Customer Profitability</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">Revenue breakdown per client — current month to date</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {rows && <button onClick={() => exportCSV('profitability.csv', columns, rows)}
            className="border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors">Export CSV</button>}
          <button onClick={run} disabled={loading}
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
              <StatCard label="Total Revenue (MTD)" value={fmtGBP(meta.totalRevenue)} accent="primary" />
              <StatCard label="Active Clients"       value={meta.totalClients} />
              {meta.period && <StatCard label="Period" value={meta.period} />}
            </div>

            {chartOpts && rows.length > 0 && (
              <div className="bg-brand-surface border border-brand-border rounded-lg p-4">
                <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Revenue by Client</div>
                <ReactApexChart type="bar"
                  series={[
                    { name: 'Picking', data: rows.map(r => r.picking) },
                    { name: 'Postage', data: rows.map(r => r.postage) },
                    { name: 'Storage', data: rows.map(r => r.storage) },
                    { name: 'Goods In', data: rows.map(r => r.goodsIn) },
                    { name: 'Returns', data: rows.map(r => r.returns) },
                    { name: 'Other',   data: rows.map(r => r.other)   },
                  ]}
                  options={chartOpts}
                  height={Math.min(Math.max(220, rows.length * 44 + 60), 400)}
                />
              </div>
            )}
          </>
        )}

        {rows && <SortableTable columns={columns} rows={rows} emptyMessage="No billing activity this month." />}
      </div>
    </div>
  )
}
