export default function ComingSoon({ title, subtitle, icon = '🔮' }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">{title}</div>
          {subtitle && <div className="font-mono text-[11px] text-ink-muted hidden sm:block">{subtitle}</div>}
        </div>
      </header>
      <div className="flex flex-col items-center justify-center h-64 text-center px-8">
        <div className="text-5xl mb-4">{icon}</div>
        <div className="font-sans font-bold text-lg text-ink mb-2">Coming Soon</div>
        <div className="font-mono text-sm text-ink-muted max-w-sm leading-relaxed">
          This report is under development. The data pipeline is being built — check back soon.
        </div>
      </div>
    </div>
  )
}
