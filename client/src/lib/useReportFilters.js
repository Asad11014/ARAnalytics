import { useState, useEffect } from 'react'

// Shared state + data fetching for multi-client and status filters on report pages.
// Returns props to spread into MultiSelect components and arrays to pass to buildReportURL.
export default function useReportFilters(session, warehouseId) {
  const [selectedClients,   setSelectedClients]   = useState(new Set())
  const [selectedStatuses,  setSelectedStatuses]  = useState(new Set())
  const [availableStatuses, setAvailableStatuses] = useState([])

  useEffect(() => {
    if (!warehouseId) return
    fetch('/api/orders/statuses')
      .then(r => r.json())
      .then(d => setAvailableStatuses(d.statuses || []))
      .catch(() => {})
  }, [warehouseId])

  // Reset filters when warehouse changes
  useEffect(() => {
    setSelectedClients(new Set())
    setSelectedStatuses(new Set())
  }, [warehouseId])

  const clientOptions = (session?.isWarehouse ? (session?.clients || []) : [])
    .map(c => ({ value: String(c.ID || c.id), label: c.Name || c.name }))
    .sort((a, b) => a.label.localeCompare(b.label))

  // Arrays to pass to buildReportURL
  const clientIds = selectedClients.size > 0 ? [...selectedClients] : []
  const statuses  = selectedStatuses.size > 0 ? [...selectedStatuses] : []

  return {
    selectedClients,  setSelectedClients,
    selectedStatuses, setSelectedStatuses,
    availableStatuses,
    clientOptions,
    clientIds,
    statuses,
  }
}
