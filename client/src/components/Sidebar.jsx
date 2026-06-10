import { useState, useCallback, useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useUI }      from '../context/UIContext'
import { TOP_LINKS, REPORT_GROUPS, QUOTE_ITEMS } from '../lib/nav'
import clsx from 'clsx'

const BADGE = {
  new:  'bg-primary/10 text-primary font-bold',
  soon: 'bg-brand-surface2 text-ink-muted',
}

function SyncButton() {
  const [phase,       setPhase]    = useState('idle')  // idle | syncing | done | partial | error
  const [stepLabel,   setStep]     = useState('')
  const [records,     setRecords]  = useState(null)
  const [elapsed,     setElapsed]  = useState(0)
  const [lastSyncAt,  setLastSync] = useState(undefined) // undefined = loading, null = never, string = date
  const pollRef  = useRef(null)
  const timerRef = useRef(null)
  const startRef = useRef(null)

  // Check sync history on mount so we know whether to run full or incremental
  useEffect(() => {
    fetch('/api/sync/status')
      .then(r => r.json())
      .then(d => setLastSync(d.lastSyncAt ?? null))
      .catch(() => setLastSync(null))
  }, [])

  const stopPolling = useCallback(() => {
    clearInterval(pollRef.current)
    clearInterval(timerRef.current)
    pollRef.current  = null
    timerRef.current = null
  }, [])

  const pollStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/sync/status')
      const data = await res.json()
      const job  = data.lastJob
      if (!job) return
      if (job.status === 'running') {
        setStep(job.current_step || 'Preparing…')
      } else if (job.status === 'success') {
        stopPolling()
        setLastSync(data.lastSyncAt)
        setRecords(job.records_synced)
        setPhase('done')
        setTimeout(() => { setPhase('idle'); setRecords(null); setElapsed(0) }, 8000)
      } else if (job.status === 'partial') {
        stopPolling()
        setLastSync(data.lastSyncAt)
        setRecords(job.records_synced)
        setPhase('partial')
        setTimeout(() => { setPhase('idle'); setRecords(null); setElapsed(0) }, 8000)
      } else if (job.status === 'error') {
        stopPolling()
        setStep(job.error || 'Unknown error')
        setPhase('error')
        setTimeout(() => { setPhase('idle'); setStep(''); setElapsed(0) }, 8000)
      }
    } catch { /* network blip — keep polling */ }
  }, [stopPolling])

  const firSync = useCallback(async (full) => {
    if (phase === 'syncing') return
    setPhase('syncing')
    setStep(full ? 'Starting full sync…' : 'Starting…')
    setRecords(null)
    setElapsed(0)
    startRef.current = Date.now()

    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full }),
      })
    } catch {
      setPhase('error')
      setStep('Could not reach server')
      setTimeout(() => { setPhase('idle'); setStep('') }, 4000)
      return
    }

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    pollRef.current = setInterval(pollStatus, 3000)
    pollStatus()
  }, [phase, pollStatus])

  useEffect(() => () => stopPolling(), [stopPolling])

  const fmtElapsed = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`

  const everSynced = !!lastSyncAt  // false on first use → full sync
  const isLoading  = lastSyncAt === undefined

  if (phase === 'syncing') {
    return (
      <div className="w-full border border-primary rounded font-mono text-[11px] py-1.5 px-2 text-primary bg-primary/5 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="truncate">{stepLabel}</span>
          <span className="ml-auto text-primary/60 flex-shrink-0">{fmtElapsed(elapsed)}</span>
        </div>
        <div className="w-full bg-primary/20 rounded-full h-0.5 overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>
    )
  }

  const label = phase === 'done'    ? `✓ Synced · ${records ?? 0} records`
              : phase === 'partial' ? `⚠ Synced · ${records ?? 0} records`
              : phase === 'error'   ? '✕ Sync failed'
              : everSynced          ? '⟳ Sync Data'
              : isLoading           ? '⟳ Sync Data'
              : '⟳ Initial Sync'
  const cls   = phase === 'done'    ? 'border-success text-success'
              : phase === 'partial' ? 'border-warning text-warning'
              : phase === 'error'   ? 'border-danger text-danger'
              : 'border-brand-border text-ink-muted hover:border-primary hover:text-primary'

  return (
    <div className="space-y-1">
      <button
        onClick={() => firSync(!everSynced)}
        disabled={isLoading}
        className={`w-full border rounded font-mono text-[11px] py-1.5 transition-colors bg-transparent cursor-pointer disabled:opacity-40 ${cls}`}
      >
        {label}
      </button>
      {/* Full resync option — only shown after initial sync has been done */}
      {everSynced && phase === 'idle' && (
        <button
          onClick={() => firSync(true)}
          className="w-full font-mono text-[10px] text-ink-dim hover:text-ink-muted transition-colors text-center py-0.5"
        >
          ↺ Full resync
        </button>
      )}
    </div>
  )
}

export default function Sidebar() {
  const { session, warehouseId, setWarehouseId, selectedClientId, setSelectedClientId } = useSession()
  const { sidebarOpen, closeSidebar } = useUI()
  const navigate   = useNavigate()
  const location   = useLocation()
  const warehouses = session?.warehouses || []
  const clients    = session?.clients    || []

  const [reportsOpen, setReportsOpen] = useState(() =>
    REPORT_GROUPS.some(g => g.items.some(item => location.pathname.startsWith(item.to)))
  )

  const [quotesOpen, setQuotesOpen] = useState(() =>
    QUOTE_ITEMS.some(item => location.pathname.startsWith(item.to))
  )

  async function logout() {
    await fetch('/api/logout', { method: 'POST' })
    navigate('/')
  }

  const visibleGroups = REPORT_GROUPS
    .filter(g => !g.warehouseOnly || session?.isWarehouse)
    .map(g => ({ ...g, items: g.items.filter(it => !(session?.demo && it.hideInDemo)) }))
    .filter(g => g.items.length)

  return (
    <aside className={clsx(
      'w-60 bg-brand-surface border-r border-brand-border flex flex-col fixed top-0 left-0 bottom-0 z-50',
      'transition-transform duration-200 ease-in-out',
      'lg:translate-x-0',
      sidebarOpen ? 'translate-x-0' : '-translate-x-full'
    )}>

      {/* Logo */}
      <div className="px-5 py-4 border-b-2 border-primary flex items-center gap-3 flex-shrink-0">
        <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-white font-extrabold text-[11px] flex-shrink-0">
          AR
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-sm text-ink leading-tight">ARAnalytics</div>
          <div className="font-mono text-[9px] text-ink-muted tracking-widest uppercase mt-0.5">
            3PL Intelligence
          </div>
        </div>
        <button onClick={closeSidebar} aria-label="Close menu"
          className="lg:hidden w-7 h-7 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-brand-surface2 rounded transition-colors">
          ✕
        </button>
      </div>

      {/* Scrollable middle */}
      <div className="flex-1 overflow-y-auto min-h-0 py-2">

        {/* Warehouse selector */}
        {warehouses.length > 1 && (
          <div className="px-4 pt-1 pb-2">
            <label className="block font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-1">Warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="w-full bg-brand-bg border border-brand-border rounded text-ink font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-primary">
              <option value="">— Select —</option>
              {warehouses.map(w => <option key={w.ID} value={String(w.ID)}>{w.Name}</option>)}
            </select>
          </div>
        )}

        {/* Client selector */}
        {session?.isWarehouse && clients.length > 0 && (
          <div className="px-4 pb-2">
            <label className="block font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-1">Client</label>
            <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}
              className="w-full bg-brand-bg border border-brand-border rounded text-ink font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-primary">
              <option value="">All clients</option>
              {[...clients].sort((a,b) => (a.Name||a.name).localeCompare(b.Name||b.name)).map(c => (
                <option key={c.ID||c.id} value={String(c.ID||c.id)}>{c.Name||c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="px-2 space-y-0.5">
          {/* Top-level standalone links */}
          {TOP_LINKS.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.exact}
              onClick={closeSidebar}
              className={({ isActive }) => clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded text-[13px] font-medium transition-all no-underline',
                isActive
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-ink-muted hover:bg-brand-surface2 hover:text-ink'
              )}
            >
              <span className="text-base w-5 text-center flex-shrink-0">{link.icon}</span>
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="h-px bg-brand-border mx-4 my-2" />

        {/* Quotes — collapsible section */}
        <div>
          <button
            onClick={() => setQuotesOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-brand-surface2 group select-none"
          >
            <span className="text-base w-5 text-center flex-shrink-0">💬</span>
            <span className={clsx(
              'flex-1 font-mono text-[10px] uppercase tracking-widest font-bold',
              quotesOpen ? 'text-primary' : 'text-ink-dim group-hover:text-ink'
            )}>
              Quotes
            </span>
            <span className={clsx('font-mono text-[10px] text-ink-dim transition-transform duration-200', quotesOpen && 'rotate-90')}>
              ▶
            </span>
          </button>

          <div className={clsx(
            'overflow-hidden transition-all duration-200',
            quotesOpen ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
          )}>
            {QUOTE_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={closeSidebar}
                className={({ isActive }) => clsx(
                  'flex items-center gap-2 pl-7 pr-3 py-1.5 text-[12px] transition-all no-underline mx-2 rounded',
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-ink-muted hover:bg-brand-surface2 hover:text-ink'
                )}
              >
                <span className="text-sm flex-shrink-0">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>

        <div className="h-px bg-brand-border mx-4 my-2" />

        {/* Reports — single collapsible section */}
        <div>
          <button
            onClick={() => setReportsOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-brand-surface2 group select-none"
          >
            <span className="text-base w-5 text-center flex-shrink-0">📊</span>
            <span className={clsx(
              'flex-1 font-mono text-[10px] uppercase tracking-widest font-bold',
              reportsOpen ? 'text-primary' : 'text-ink-dim group-hover:text-ink'
            )}>
              Reports
            </span>
            <span className={clsx('font-mono text-[10px] text-ink-dim transition-transform duration-200', reportsOpen && 'rotate-90')}>
              ▶
            </span>
          </button>

          <div className={clsx(
            'overflow-hidden transition-all duration-200',
            reportsOpen ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
          )}>
            {visibleGroups.map((group, gi) => (
              <div key={group.id}>
                {/* Sub-category label */}
                <div className="px-4 pt-2 pb-0.5">
                  <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-ink-dim font-bold">
                    {group.label}
                  </span>
                </div>

                {/* Items */}
                {group.items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={closeSidebar}
                    className={({ isActive }) => clsx(
                      'flex items-center gap-2 pl-7 pr-3 py-1.5 text-[12px] transition-all no-underline mx-2 rounded',
                      isActive
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-ink-muted hover:bg-brand-surface2 hover:text-ink'
                    )}
                  >
                    <span className="text-sm flex-shrink-0">{item.icon}</span>
                    <span className="flex-1 truncate">
                      {(!session?.isWarehouse && item.clientLabel) ? item.clientLabel : item.label}
                    </span>
                    {item.badge && (
                      <span className={clsx('font-mono text-[8px] px-1 py-0.5 rounded uppercase tracking-wide', BADGE[item.badge])}>
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                ))}

                {/* Divider between groups, but not after the last one */}
                {gi < visibleGroups.length - 1 && (
                  <div className="h-px bg-brand-border mx-4 mt-2" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer — always pinned */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-brand-border space-y-2">
        <div className="font-mono text-[11px] text-ink-muted">
          <strong className="block text-ink text-xs mb-0.5 truncate">{session?.username}</strong>
          {session?.demo ? 'Demo mode' : session?.isWarehouse ? 'Warehouse user' : 'Client user'}
        </div>
        {session?.isWarehouse && !session?.demo && <SyncButton />}
        <button onClick={logout}
          className="w-full border border-brand-border rounded text-ink-muted font-mono text-[11px] py-1.5 hover:border-danger hover:text-danger transition-colors bg-transparent cursor-pointer">
          Sign Out
        </button>
      </div>
    </aside>
  )
}
