// Shared status metadata for returns — keep in sync with RETURN_STATUSES in server/returns.js
export const RETURN_STATUS_META = {
  pending:   { label: 'Pending',   badge: 'bg-gold/15 text-gold border-gold/30' },
  booked:    { label: 'Booked',    badge: 'bg-primary/10 text-primary border-primary/30' },
  collected: { label: 'Collected', badge: 'bg-purple-500/10 text-purple-600 border-purple-500/30' },
  completed: { label: 'Completed', badge: 'bg-success/10 text-success border-success/30' },
  cancelled: { label: 'Cancelled', badge: 'bg-ink-muted/10 text-ink-muted border-ink-muted/30' },
}

export const RETURN_STATUSES = Object.keys(RETURN_STATUS_META)

export function StatusBadge({ status }) {
  const m = RETURN_STATUS_META[status] || { label: status, badge: 'bg-ink-muted/10 text-ink-muted border-ink-muted/30' }
  return (
    <span className={`inline-block font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${m.badge}`}>
      {m.label}
    </span>
  )
}
