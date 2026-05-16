import clsx from 'clsx'

const variants = {
  default:  'bg-primary-light text-primary border-primary/20',
  success:  'bg-success/10 text-success border-success/20',
  danger:   'bg-danger/10 text-danger border-danger/20',
  warning:  'bg-warning/10 text-[#a07830] border-warning/30',
  muted:    'bg-brand-surface2 text-ink-muted border-brand-border',
  critical: 'bg-danger/10 text-danger border-danger/20',
  attention:'bg-warning/10 text-[#a07830] border-warning/30',
  healthy:  'bg-success/10 text-success border-success/20',
}

export default function Badge({ label, variant = 'muted', dot = true }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold',
      'border tracking-wide uppercase font-mono',
      variants[variant] || variants.muted
    )}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {label}
    </span>
  )
}
