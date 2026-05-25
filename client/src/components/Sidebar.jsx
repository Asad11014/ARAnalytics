import { useState, useCallback } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useUI }      from '../context/UIContext'
import { TOP_LINKS, REPORT_GROUPS } from '../lib/nav'
import clsx from 'clsx'

const BADGE = {
  new:  'bg-primary/10 text-primary font-bold',
  soon: 'bg-brand-surface2 text-ink-muted',
}

function SyncButton() {
  const [state, setState] = useState('idle')

  const trigger = useCallback(async () => {
    setState('syncing')
    try {
      await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full: true }) })
      setState('done')
      setTimeout(() => setState('idle'), 4000)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 4000)
    }
  }, [])

  const label = state === 'syncing' ? '⟳ Syncing…' : state === 'done' ? '✓ Sync queued' : state === 'error' ? '✕ Sync failed' : '⟳ Sync Data'
  const cls   = state === 'done'    ? 'border-success text-success'
              : state === 'error'   ? 'border-danger text-danger'
              : state === 'syncing' ? 'border-primary text-primary opacity-60'
              : 'border-brand-border text-ink-muted hover:border-primary hover:text-primary'

  return (
    <button onClick={trigger} disabled={state === 'syncing'}
      className={`w-full border rounded font-mono text-[11px] py-1.5 transition-colors bg-transparent cursor-pointer ${cls}`}>
      {label}
    </button>
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

  async function logout() {
    await fetch('/api/logout', { method: 'POST' })
    navigate('/')
  }

  const visibleGroups = REPORT_GROUPS.filter(g => !g.warehouseOnly || session?.isWarehouse)

  return (
    <aside className={clsx(
      'w-60 bg-brand-surface border-r border-brand-border flex flex-col fixed top-0 left-0 bottom-0 z-50',
      'transition-transform duration-200 ease-in-out',
      'lg:translate-x-0',
      sidebarOpen ? 'translate-x-0' : '-translate-x-full'
    )}>

      {/* Logo */}
      <div className="px-5 py-4 border-b-2 border-primary flex items-center gap-3 flex-shrink-0">
        <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-white font-extrabold text-sm flex-shrink-0">
          PF
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-sm text-ink leading-tight">PF Analytics</div>
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
          {session?.isWarehouse ? 'Warehouse user' : 'Client user'}
        </div>
        {session?.isWarehouse && <SyncButton />}
        <button onClick={logout}
          className="w-full border border-brand-border rounded text-ink-muted font-mono text-[11px] py-1.5 hover:border-danger hover:text-danger transition-colors bg-transparent cursor-pointer">
          Sign Out
        </button>
      </div>
    </aside>
  )
}
