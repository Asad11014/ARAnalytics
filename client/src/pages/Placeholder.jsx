// Generic "coming soon" page for Client Hub sub-pages not yet built.
// Each route passes its own title + blurb so the sidebar is fully navigable
// while the underlying features are developed in stages.

export default function Placeholder({ title, blurb, icon = '🚧' }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center sticky top-0 z-40">
        <div className="font-sans font-bold text-[15px] text-ink">{title}</div>
      </header>

      <div className="p-4 sm:p-7">
        <div className="bg-brand-surface border border-brand-border rounded-lg p-10 flex flex-col items-center justify-center text-center max-w-2xl mx-auto min-h-[320px]">
          <div className="text-5xl mb-4">{icon}</div>
          <div className="font-sans font-bold text-lg text-ink mb-2">{title}</div>
          <p className="font-mono text-xs text-ink-muted max-w-md leading-relaxed">
            {blurb || 'This section is coming soon. It’s part of the Premium Fulfilment Hub roadmap and will be built out in an upcoming phase.'}
          </p>
          <span className="mt-5 font-mono text-[10px] uppercase tracking-widest text-gold bg-gold/10 border border-gold/30 rounded px-3 py-1">
            In development
          </span>
        </div>
      </div>
    </div>
  )
}
