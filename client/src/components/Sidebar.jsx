import { useState, useCallback, useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useUI }      from '../context/UIContext'
import { TOP_LINKS, REPORT_GROUPS, QUOTE_ITEMS, CLIENT_NAV } from '../lib/nav'
import clsx from 'clsx'

const BADGE = {
  new:  'bg-gold/20 text-gold font-bold',
  soon: 'bg-white/10 text-white/50',
}

function SyncButton({ incrementalOnly = false }) {
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
      <div className="w-full border border-gold rounded font-mono text-[11px] py-1.5 px-2 text-gold bg-gold/10 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 border border-gold border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="truncate">{stepLabel}</span>
          <span className="ml-auto text-gold/70 flex-shrink-0">{fmtElapsed(elapsed)}</span>
        </div>
        <div className="w-full bg-gold/20 rounded-full h-0.5 overflow-hidden">
          <div className="h-full bg-gold rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>
    )
  }

  const label = phase === 'done'    ? `✓ Synced · ${records ?? 0} records`
              : phase === 'partial' ? `⚠ Synced · ${records ?? 0} records`
              : phase === 'error'   ? '✕ Sync failed'
              : everSynced          ? '⟳ Sync Data'
              : isLoading           ? '⟳ Sync Data'
              : incrementalOnly     ? '⟳ Sync Data'
              : '⟳ Initial Sync'
  const cls   = phase === 'done'    ? 'border-success text-success'
              : phase === 'partial' ? 'border-gold text-gold'
              : phase === 'error'   ? 'border-danger text-danger'
              : 'border-white/20 text-white/80 hover:border-gold hover:text-gold'

  return (
    <div className="space-y-1">
      <button
        onClick={() => firSync(incrementalOnly ? false : !everSynced)}
        disabled={isLoading}
        className={`w-full border rounded font-mono text-[11px] py-1.5 transition-colors bg-transparent cursor-pointer disabled:opacity-40 ${cls}`}
      >
        {label}
      </button>
      {/* Full resync option — warehouse only, after initial sync has been done */}
      {!incrementalOnly && everSynced && phase === 'idle' && (
        <button
          onClick={() => firSync(true)}
          className="w-full font-mono text-[10px] text-white/40 hover:text-white/70 transition-colors text-center py-0.5"
        >
          ↺ Full resync
        </button>
      )}
    </div>
  )
}

// Recursively flatten a group's leaf routes (for active-state detection).
function flattenRoutes(node) {
  if (node.items) return node.items.flatMap(flattenRoutes)
  return node.to ? [node.to] : []
}

// A single client-nav node — either a leaf link or a (possibly nested) group.
function NavNode({ node, closeSidebar, depth }) {
  if (node.items) return <CollapsibleGroup group={node} closeSidebar={closeSidebar} depth={depth} />
  return (
    <NavLink
      to={node.to}
      onClick={closeSidebar}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      className={({ isActive }) => clsx(
        'flex items-center gap-2 pr-3 py-1.5 text-[12px] transition-all no-underline mx-2 rounded border-l-2',
        isActive
          ? 'bg-white/10 text-white font-semibold border-gold'
          : 'text-white/70 hover:bg-white/5 hover:text-white border-transparent'
      )}
    >
      <span className="text-sm flex-shrink-0">{node.icon}</span>
      <span className="flex-1 truncate">{node.clientLabel || node.label}</span>
    </NavLink>
  )
}

// A collapsible nav group for the Client Hub menu (self-managed open state).
// Supports nesting (e.g. Stock Analytics → Reports → report pages).
function CollapsibleGroup({ group, closeSidebar, depth = 0 }) {
  const location = useLocation()
  const [open, setOpen] = useState(() => flattenRoutes(group).some(to => location.pathname.startsWith(to)))

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ paddingLeft: `${16 + depth * 12}px` }}
        className="w-full flex items-center gap-2.5 pr-3 py-2 text-left transition-colors hover:bg-white/5 group select-none"
      >
        <span className="text-base w-5 text-center flex-shrink-0">{group.icon}</span>
        <span className={clsx(
          'flex-1 font-mono uppercase tracking-widest font-bold',
          depth === 0 ? 'text-[10px]' : 'text-[9px]',
          open ? 'text-gold' : 'text-white/50 group-hover:text-white'
        )}>
          {group.label}
        </span>
        <span className={clsx('font-mono text-[10px] text-white/40 transition-transform duration-200', open && 'rotate-90')}>
          ▶
        </span>
      </button>

      <div className={clsx(
        'overflow-hidden transition-all duration-200',
        open ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0'
      )}>
        {group.items.map((node, i) => (
          <NavNode key={node.to || node.id || i} node={node} closeSidebar={closeSidebar} depth={depth + 1} />
        ))}
      </div>
    </div>
  )
}

// PF Client Hub navigation — flat links + collapsible groups (clients only).
function ClientNav({ closeSidebar }) {
  return (
    <div className="space-y-0.5">
      {CLIENT_NAV.map(entry => entry.type === 'link' ? (
        <div key={entry.to} className="px-2">
          <NavLink
            to={entry.to}
            end={entry.exact}
            onClick={closeSidebar}
            className={({ isActive }) => clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded text-[13px] font-medium transition-all no-underline border-l-2',
              isActive
                ? 'bg-white/10 text-white font-semibold border-gold'
                : 'text-white/70 hover:bg-white/5 hover:text-white border-transparent'
            )}
          >
            <span className="text-base w-5 text-center flex-shrink-0">{entry.icon}</span>
            {entry.label}
          </NavLink>
        </div>
      ) : (
        <CollapsibleGroup key={entry.id} group={entry} closeSidebar={closeSidebar} />
      ))}
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
      'w-60 bg-navy border-r border-navy-dark flex flex-col fixed top-16 left-0 bottom-0 z-40',
      'transition-transform duration-200 ease-in-out',
      'lg:translate-x-0',
      sidebarOpen ? 'translate-x-0' : '-translate-x-full'
    )}>

      {/* Scrollable middle */}
      <div className="flex-1 overflow-y-auto min-h-0 py-2">

        {/* Warehouse selector */}
        {warehouses.length > 1 && (
          <div className="px-4 pt-1 pb-2">
            <label className="block font-mono text-[9px] text-white/50 uppercase tracking-widest mb-1">Warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="w-full bg-navy-dark border border-white/15 rounded text-white font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-gold">
              <option value="">— Select —</option>
              {warehouses.map(w => <option key={w.ID} value={String(w.ID)}>{w.Name}</option>)}
            </select>
          </div>
        )}

        {/* Client selector */}
        {session?.isWarehouse && clients.length > 0 && (
          <div className="px-4 pb-2">
            <label className="block font-mono text-[9px] text-white/50 uppercase tracking-widest mb-1">Client</label>
            <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}
              className="w-full bg-navy-dark border border-white/15 rounded text-white font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-gold">
              <option value="">All clients</option>
              {[...clients].sort((a,b) => (a.Name||a.name).localeCompare(b.Name||b.name)).map(c => (
                <option key={c.ID||c.id} value={String(c.ID||c.id)}>{c.Name||c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* ── Client Hub nav (client users only) ── */}
        {!session?.isWarehouse && <ClientNav closeSidebar={closeSidebar} />}

        {/* ── Warehouse Hub nav (warehouse users only) ── */}
        {session?.isWarehouse && (
        <>
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
                  ? 'bg-white/10 text-white font-semibold border-l-2 border-gold'
                  : 'text-white/70 hover:bg-white/5 hover:text-white border-l-2 border-transparent'
              )}
            >
              <span className="text-base w-5 text-center flex-shrink-0">{link.icon}</span>
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="h-px bg-white/10 mx-4 my-2" />

        {/* Quotes — collapsible section */}
        <div>
          <button
            onClick={() => setQuotesOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-white/5 group select-none"
          >
            <span className="text-base w-5 text-center flex-shrink-0">💬</span>
            <span className={clsx(
              'flex-1 font-mono text-[10px] uppercase tracking-widest font-bold',
              quotesOpen ? 'text-gold' : 'text-white/50 group-hover:text-white'
            )}>
              Quotes
            </span>
            <span className={clsx('font-mono text-[10px] text-white/40 transition-transform duration-200', quotesOpen && 'rotate-90')}>
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
                  'flex items-center gap-2 pl-7 pr-3 py-1.5 text-[12px] transition-all no-underline mx-2 rounded border-l-2',
                  isActive
                    ? 'bg-white/10 text-white font-semibold border-gold'
                    : 'text-white/70 hover:bg-white/5 hover:text-white border-transparent'
                )}
              >
                <span className="text-sm flex-shrink-0">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>

        <div className="h-px bg-white/10 mx-4 my-2" />

        {/* Reports — single collapsible section */}
        <div>
          <button
            onClick={() => setReportsOpen(o => !o)}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-white/5 group select-none"
          >
            <span className="text-base w-5 text-center flex-shrink-0">📊</span>
            <span className={clsx(
              'flex-1 font-mono text-[10px] uppercase tracking-widest font-bold',
              reportsOpen ? 'text-gold' : 'text-white/50 group-hover:text-white'
            )}>
              Reports
            </span>
            <span className={clsx('font-mono text-[10px] text-white/40 transition-transform duration-200', reportsOpen && 'rotate-90')}>
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
                  <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-white/40 font-bold">
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
                      'flex items-center gap-2 pl-7 pr-3 py-1.5 text-[12px] transition-all no-underline mx-2 rounded border-l-2',
                      isActive
                        ? 'bg-white/10 text-white font-semibold border-gold'
                        : 'text-white/70 hover:bg-white/5 hover:text-white border-transparent'
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
                  <div className="h-px bg-white/10 mx-4 mt-2" />
                )}
              </div>
            ))}
          </div>
        </div>
        </>
        )}
      </div>

      {/* Footer — always pinned */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-white/10 space-y-2">
        <div className="font-mono text-[11px] text-white/60">
          <strong className="block text-white text-xs mb-0.5 truncate">{session?.username}</strong>
          {session?.demo ? 'Demo mode' : session?.isWarehouse ? 'Warehouse user' : 'Client user'}
        </div>
        {!session?.demo && <SyncButton incrementalOnly={!session?.isWarehouse} />}
        <button onClick={logout}
          className="w-full border border-white/20 rounded text-white/70 font-mono text-[11px] py-1.5 hover:border-danger hover:text-danger transition-colors bg-transparent cursor-pointer">
          Sign Out
        </button>
      </div>
    </aside>
  )
}
