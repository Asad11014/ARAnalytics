import { useState } from 'react'
import clsx from 'clsx'

// columns: [{ key, label, align?, render?, csvValue? }]
// rows: array of objects
// fillHeight: true inside dashboard panels (table fills remaining flex space and scrolls internally)
//             false/default in report pages (table scrolls within a 60vh max-height)
export default function SortableTable({ columns, rows, emptyMessage = 'No data found.', fillHeight = false }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(-1)

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d * -1)
    else { setSortKey(key); setSortDir(-1) }
  }

  const sorted = [...rows].sort((a, b) => {
    if (!sortKey) return 0
    const av = a[sortKey], bv = b[sortKey]
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return av.localeCompare(bv) * sortDir
    return (av - bv) * sortDir
  })

  if (!rows.length) {
    return (
      <div className="text-center py-16 text-ink-muted font-mono text-sm">
        <div className="text-4xl mb-3">🔍</div>
        {emptyMessage}
      </div>
    )
  }

  return (
    // Self-contained scroll container so sticky thead always works.
    // fillHeight=true: takes remaining flex space in panel (flex-1 min-h-0).
    // fillHeight=false: caps at 60vh so reports pages also get a sticky header.
    <div className={clsx(
      'overflow-auto rounded-lg border border-brand-border',
      fillHeight ? 'flex-1 min-h-0' : 'max-h-[60vh]'
    )}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={clsx(
                  'px-2 py-2 sm:px-4 sm:py-2.5 text-left bg-brand-surface2 border-b border-brand-border',
                  'font-mono text-[10px] text-ink-muted tracking-widest uppercase',
                  'cursor-pointer select-none whitespace-nowrap hover:text-primary transition-colors',
                  sortKey === col.key && 'text-primary',
                  col.align === 'right' && 'text-right'
                )}
                style={col.align === 'right' ? { textAlign: 'right' } : {}}
              >
                {col.label}
                <span className="ml-1 opacity-50">
                  {sortKey === col.key ? (sortDir > 0 ? '↑' : '↓') : '↕'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              className="border-b border-brand-border last:border-0 hover:bg-brand-surface2 transition-colors"
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={clsx(
                    'px-2 py-2 sm:px-4 sm:py-3 font-mono text-[12px] text-ink align-middle',
                    col.align === 'right' && 'text-right'
                  )}
                >
                  {col.render ? col.render(row) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
