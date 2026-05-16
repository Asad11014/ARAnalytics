import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useSession } from '../context/SessionContext'
import Sidebar       from '../components/Sidebar'
import Dashboard     from './Dashboard'
import Replenishment from './reports/Replenishment'
import DeadStock     from './reports/DeadStock'
import Overstock     from './reports/Overstock'
import BestSellers   from './reports/BestSellers'
import SalesTrend    from './reports/SalesTrend'

export default function AppShell() {
  const { session, loading } = useSession()
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
      <Sidebar />
      <main className="ml-60 flex-1 min-h-screen flex flex-col">
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
