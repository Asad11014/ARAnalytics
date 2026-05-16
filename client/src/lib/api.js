// Builds a report API URL with the standard query params
export function buildReportURL(reportId, { warehouseId, clientId, days = 30, ...extra } = {}) {
  const today = new Date()
  const from  = new Date(today)
  from.setDate(today.getDate() - days)
  const fmt = d => d.toISOString().split('T')[0]

  const params = new URLSearchParams({
    warehouseId: warehouseId || '',
    clientId:    clientId   || '',
    dateFrom:    fmt(from),
    dateTo:      fmt(today),
    days,
    ...extra
  })
  return `/api/report/${reportId}?${params}`
}

// Builds the dashboard API URL. Pass refresh=true to bypass server cache.
export function buildDashboardURL({ warehouseId, clientId, refresh = false } = {}) {
  const params = new URLSearchParams({ warehouseId: warehouseId || '', clientId: clientId || '' })
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
