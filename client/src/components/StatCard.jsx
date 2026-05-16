import clsx from 'clsx'

// delta: number — positive = green, negative = red
export default function StatCard({ label, value, delta, deltaLabel, accent, loading }) {
  const deltaPositive = delta != null && delta > 0
  const deltaNegative = delta != null && delta < 0

  return (
    <div className="bg-brand-surface border border-brand-border rounded-lg p-5 flex-1 min-w-[130px]">
      <div className="text-[10px] font-mono text-ink-muted tracking-widest uppercase mb-2">
        {label}
      </div>
      {loading ? (
        <div className="h-8 w-24 bg-brand-surface2 rounded animate-pulse" />
      ) : (
        <div className={clsx(
          'text-3xl font-extrabold leading-none font-sans',
          accent === 'danger'  && 'text-danger',
          accent === 'success' && 'text-success',
          accent === 'warning' && 'text-warning',
          accent === 'primary' && 'text-primary',
          !accent && 'text-ink'
        )}>
          {value ?? '—'}
        </div>
      )}
      {delta != null && !loading && (
        <div className={clsx(
          'mt-1.5 text-[11px] font-mono',
          deltaPositive && 'text-success',
          deltaNegative && 'text-danger',
          !deltaPositive && !deltaNegative && 'text-ink-muted'
        )}>
          {deltaPositive ? '▲' : deltaNegative ? '▼' : '–'}{' '}
          {Math.abs(delta)}% {deltaLabel || 'vs prev period'}
        </div>
      )}
    </div>
  )
}
