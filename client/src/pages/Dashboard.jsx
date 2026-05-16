import { useSession } from '../context/SessionContext'
import WarehouseDashboard from './WarehouseDashboard'
import ClientDashboard    from './ClientDashboard'

export default function Dashboard() {
  const { session } = useSession()
  return session?.isWarehouse ? <WarehouseDashboard /> : <ClientDashboard />
}
