import { NavLink, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import clsx from 'clsx'

const NAV = [
  { to: '/app',                  label: 'Dashboard',          icon: '⬛' },
  { to: '/app/reports/replenishment', label: 'Replenishment', icon: '📦' },
  { to: '/app/reports/dead-stock',    label: 'Dead Stock',    icon: '🪦' },
  { to: '/app/reports/overstock',     label: 'Overstock',     icon: '📈' },
  { to: '/app/reports/best-sellers',  label: 'Best Sellers',  icon: '🏆' },
  { to: '/app/reports/sales-trend',   label: 'Sales Trend',   icon: '📊' },
]

export default function Sidebar() {
  const { session, warehouseId, setWarehouseId, selectedClientId, setSelectedClientId } = useSession()
  const navigate = useNavigate()

  const warehouses = session?.warehouses || []
  const clients    = session?.clients    || []

  async function logout() {
    await fetch('/api/logout', { method: 'POST' })
    navigate('/')
  }

  return (
    <aside className="w-60 bg-brand-surface border-r border-brand-border flex flex-col fixed top-0 left-0 bottom-0 z-50">

      {/* Logo */}
      <div className="px-5 py-5 border-b-2 border-primary flex items-center gap-3 flex-shrink-0">
        <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-white font-extrabold text-sm flex-shrink-0">
          PF
        </div>
        <div>
          <div className="font-extrabold text-sm text-ink leading-tight">PF Analytics</div>
          <div className="font-mono text-[9px] text-ink-muted tracking-widest uppercase mt-0.5">
            Inventory Intelligence
          </div>
        </div>
      </div>

      {/* Warehouse selector */}
      {warehouses.length > 1 && (
        <div className="px-4 pt-4 pb-2">
          <label className="block font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-1.5">
            Warehouse
          </label>
          <select
            value={warehouseId}
            onChange={e => setWarehouseId(e.target.value)}
            className="w-full bg-brand-bg border border-brand-border rounded text-ink font-mono text-xs px-2.5 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            <option value="">— Select —</option>
            {warehouses.map(w => (
              <option key={w.ID} value={String(w.ID)}>{w.Name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Client selector (warehouse users only) */}
      {session?.isWarehouse && clients.length > 0 && (
        <div className="px-4 pb-3">
          <label className="block font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-1.5">
            Client
          </label>
          <select
            value={selectedClientId}
            onChange={e => setSelectedClientId(e.target.value)}
            className="w-full bg-brand-bg border border-brand-border rounded text-ink font-mono text-xs px-2.5 py-1.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            <option value="">All clients</option>
            {[...clients]
              .sort((a, b) => (a.Name || a.name).localeCompare(b.Name || b.name))
              .map(c => (
                <option key={c.ID || c.id} value={String(c.ID || c.id)}>
                  {c.Name || c.name}
                </option>
              ))
            }
          </select>
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-brand-border mx-4 mb-2" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-1">
        <div className="px-5 py-2 font-mono text-[9px] text-ink-dim uppercase tracking-widest">
          Reports
        </div>
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/app'}
            className={({ isActive }) => clsx(
              'flex items-center gap-2.5 px-5 py-2.5 text-[13px] font-medium transition-all',
              'border-l-[3px] no-underline',
              isActive
                ? 'bg-brand-surface2 text-primary border-primary font-semibold'
                : 'text-ink-muted border-transparent hover:bg-brand-surface2 hover:text-ink'
            )}
          >
            <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-auto px-4 py-4 border-t border-brand-border flex-shrink-0">
        <div className="font-mono text-[11px] text-ink-muted mb-2">
          <strong className="block text-ink text-xs mb-0.5">{session?.username}</strong>
          {session?.isWarehouse ? 'Warehouse user' : 'Client user'}
        </div>
        <button
          onClick={logout}
          className="w-full border border-brand-border rounded text-ink-muted font-mono text-[11px] py-1.5 hover:border-danger hover:text-danger transition-colors bg-transparent cursor-pointer"
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}
