// Builds a report API URL with the standard query params.
// clientIds: string[] of Mintsoft client IDs (multi-select); takes priority over single clientId.
// statuses:  string[] of order status values to include.
export function buildReportURL(reportId, { warehouseId, clientId, clientIds = [], statuses = [], days = 30, ...extra } = {}) {
  const today = new Date()
  const from  = new Date(today)
  from.setDate(today.getDate() - days)
  const fmt = d => d.toISOString().split('T')[0]

  const params = new URLSearchParams({
    warehouseId: warehouseId || '',
    clientId:    clientIds.length ? '' : (clientId || ''),
    clientIds:   clientIds.join(','),
    statuses:    statuses.join(','),
    dateFrom:    fmt(from),
    dateTo:      fmt(today),
    days,
    ...extra
  })
  return `/api/report/${reportId}?${params}`
}

// Builds the dashboard API URL.
// statuses: string[] of order status values; empty = all statuses.
export function buildDashboardURL({ warehouseId, clientId, statuses = [], refresh = false } = {}) {
  const params = new URLSearchParams({
    warehouseId: warehouseId || '',
    clientId:    clientId   || '',
    statuses:    statuses.join(','),
  })
  if (refresh) params.set('refresh', 'true')
  return `/api/dashboard?${params}`
}

// Exports rows to a CSV file download
export function exportCSV(filename, columns, rows) {
  const headers = columns.map(c => `"${c.label}"`).join(',')
  const body    = rows.map(row =>
    columns.map(c => {
      const v = c.csvValue ? c.csvValue(row) : (row[c.key] ?? '')
      return `"${String(v).replace(/"/g, '""')}"`
    }).join(',')
  ).join('\n')

  const blob = new Blob([headers + '\n' + body], { type: 'text/csv' })
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}
