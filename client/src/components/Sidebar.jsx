import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useUI }      from '../context/UIContext'
import { NAV_SECTIONS } from '../lib/nav'
import clsx from 'clsx'

const BADGE = {
  new:  'bg-primary/10 text-primary font-bold',
  soon: 'bg-brand-surface2 text-ink-muted',
}

function SectionHeader({ section, isOpen, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={clsx(
        'w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors select-none',
        'hover:bg-brand-surface2 group',
      )}
    >
      <span className="text-base w-5 text-center flex-shrink-0">{section.icon}</span>
      <span className={clsx(
        'flex-1 font-mono text-[10px] uppercase tracking-widest font-bold',
        isOpen ? 'text-primary' : 'text-ink-dim group-hover:text-ink'
      )}>
        {section.label}
      </span>
      <span className={clsx('font-mono text-[10px] text-ink-dim transition-transform duration-200', isOpen && 'rotate-90')}>
        ▶
      </span>
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

  // Auto-open the section that contains the active route
  const activeSection = NAV_SECTIONS.find(s =>
    s.items.some(item => location.pathname.startsWith(item.to))
  )?.id

  const [openSections, setOpenSections] = useState(() =>
    activeSection ? [activeSection] : ['inventory']
  )

  useEffect(() => {
    if (activeSection && !openSections.includes(activeSection)) {
      setOpenSections(prev => [...prev, activeSection])
    }
  }, [activeSection])

  function toggleSection(id) {
    setOpenSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' })
    navigate('/')
  }

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
      <div className="flex-1 overflow-y-auto min-h-0 py-1">

        {/* Warehouse selector */}
        {warehouses.length > 1 && (
          <div className="px-4 pt-3 pb-2">
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

        {/* Dashboard link */}
        <div className="px-2 pt-1 pb-0.5">
          <NavLink to="/app" end onClick={closeSidebar}
            className={({ isActive }) => clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded text-[13px] font-medium transition-all no-underline',
              isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-ink-muted hover:bg-brand-surface2 hover:text-ink'
            )}>
            <span className="text-base w-5 text-center flex-shrink-0">⬛</span>
            Dashboard
          </NavLink>
        </div>

        <div className="h-px bg-brand-border mx-4 my-1.5" />

        {/* Collapsible sections */}
        {NAV_SECTIONS.map(section => {
          const isOpen = openSections.includes(section.id)
          return (
            <div key={section.id}>
              <SectionHeader section={section} isOpen={isOpen} onToggle={() => toggleSection(section.id)} />

              {/* Animated items list */}
              <div className={clsx(
                'overflow-hidden transition-all duration-200',
                isOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
              )}>
                {section.items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={closeSidebar}
                    className={({ isActive }) => clsx(
                      'flex items-center gap-2 pl-8 pr-3 py-1.5 text-[12px] transition-all no-underline',
                      'border-l-2 mx-2 rounded-r',
                      isActive
                        ? 'bg-primary/10 text-primary border-primary font-semibold'
                        : 'text-ink-muted border-transparent hover:bg-brand-surface2 hover:text-ink hover:border-brand-border'
                    )}
                  >
                    <span className="text-sm flex-shrink-0">{item.icon}</span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <span className={clsx('font-mono text-[8px] px-1 py-0.5 rounded uppercase tracking-wide', BADGE[item.badge])}>
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer — always pinned */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-brand-border">
        <div className="font-mono text-[11px] text-ink-muted mb-2">
          <strong className="block text-ink text-xs mb-0.5 truncate">{session?.username}</strong>
          {session?.isWarehouse ? 'Warehouse user' : 'Client user'}
        </div>
        <button onClick={logout}
          className="w-full border border-brand-border rounded text-ink-muted font-mono text-[11px] py-1.5 hover:border-danger hover:text-danger transition-colors bg-transparent cursor-pointer">
          Sign Out
        </button>
      </div>
    </aside>
  )
}
