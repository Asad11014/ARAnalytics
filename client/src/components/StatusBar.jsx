import clsx from 'clsx'

export default function StatusBar({ message, type }) {
  if (!message) return null

  return (
    <div className={clsx(
      'flex items-center gap-2 px-4 py-2.5 rounded-lg border mb-4',
      'font-mono text-xs',
      type === 'error'   && 'border-danger/40 bg-danger/5 text-danger',
      type === 'success' && 'border-primary/30 bg-primary-light text-primary',
      type === 'loading' && 'border-brand-border bg-brand-surface text-ink-muted',
    )}>
      {type === 'loading' && (
        <span className="inline-block w-3 h-3 border-2 border-brand-border border-t-primary rounded-full animate-spin flex-shrink-0" />
      )}
      {message}
    </div>
  )
}
