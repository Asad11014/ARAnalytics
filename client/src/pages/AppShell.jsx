import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useSession } from '../context/SessionContext'
import { UIProvider, useUI } from '../context/UIContext'
import Sidebar       from '../components/Sidebar'
import Dashboard     from './Dashboard'
import Replenishment from './reports/Replenishment'
import DeadStock     from './reports/DeadStock'
import Overstock     from './reports/Overstock'
import BestSellers   from './reports/BestSellers'
import SalesTrend    from './reports/SalesTrend'

function AppShellLayout() {
  const { session, loading } = useSession()
  const { sidebarOpen, openSidebar, closeSidebar } = useUI()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !session) navigate('/', { replace: true })
  }, [session, loading, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-border border-t-primary rounded-full animate-spin" />
          <span className="font-mono text-xs text-ink-muted">Loading…</span>
        </div>
      </div>
    )
  }

  if (!session) return null

  return (
    <div className="flex min-h-screen bg-brand-bg">

      {/* Mobile top bar — hamburger + app name */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-12 bg-brand-surface border-b border-brand-border flex items-center px-4 z-30 gap-3">
        <button
          onClick={openSidebar}
          aria-label="Open menu"
          className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-brand-surface2 rounded transition-colors"
        >
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
            <rect y="0"  width="18" height="2" rx="1" fill="currentColor"/>
            <rect y="6"  width="18" height="2" rx="1" fill="currentColor"/>
            <rect y="12" width="18" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>
        <span className="font-extrabold text-sm text-ink">PF Analytics</span>
      </div>

      {/* Backdrop — tapping closes sidebar on mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      <Sidebar />

      {/* pt-12 on mobile creates space below the fixed top bar; min-w-0 prevents flex child from expanding past viewport width */}
      <main className="lg:ml-60 flex-1 min-h-screen flex flex-col pt-12 lg:pt-0 min-w-0 overflow-x-hidden">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="reports/replenishment" element={<Replenishment />} />
          <Route path="reports/dead-stock"    element={<DeadStock />} />
          <Route path="reports/overstock"     element={<Overstock />} />
          <Route path="reports/best-sellers"  element={<BestSellers />} />
          <Route path="reports/sales-trend"   element={<SalesTrend />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function AppShell() {
  return (
    <UIProvider>
      <AppShellLayout />
    </UIProvider>
  )
}
