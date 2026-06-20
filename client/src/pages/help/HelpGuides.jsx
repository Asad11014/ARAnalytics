import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { HELP_GUIDES } from '../../lib/helpGuides'

export default function HelpGuides() {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return HELP_GUIDES
    return HELP_GUIDES.filter(g =>
      g.title.toLowerCase().includes(s) ||
      g.summary.toLowerCase().includes(s) ||
      g.category.toLowerCase().includes(s))
  }, [q])

  const featured = HELP_GUIDES.filter(g => g.published)

  // Group the (filtered) guides by category.
  const groups = useMemo(() => {
    const m = {}
    filtered.forEach(g => { (m[g.category] = m[g.category] || []).push(g) })
    return Object.entries(m)
  }, [filtered])

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Help Guides</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">How-to guides for sourcing, importing, selling and using the Hub</div>
        </div>
      </header>

      <div className="p-4 sm:p-7 max-w-4xl mx-auto space-y-8">
        {/* Search */}
        <div className="relative">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search help guides…"
            className="w-full bg-brand-surface border border-brand-border rounded-lg pl-10 pr-4 py-3 font-sans text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-primary transition-colors"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-dim" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2"/><path d="M14 14l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>

        {/* Featured / top guides */}
        {!q && featured.length > 0 && (
          <div>
            <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Top Guides</div>
            <div className="space-y-3">
              {featured.map(g => (
                <Link key={g.slug} to={`/app/help/${g.slug}`}
                  className="block bg-primary/5 border border-primary/20 rounded-xl p-5 hover:border-primary transition-colors no-underline group">
                  <div className="font-sans font-bold text-base text-ink group-hover:text-primary transition-colors">{g.title}</div>
                  <p className="font-sans text-sm text-ink-muted mt-1">{g.summary}</p>
                  <span className="font-mono text-[11px] text-primary mt-2 inline-block">Read guide →</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* All guides grouped by category */}
        {groups.length === 0 ? (
          <div className="text-center py-10 font-mono text-sm text-ink-muted">No guides match “{q}”.</div>
        ) : (
          groups.map(([category, guides]) => (
            <div key={category}>
              <div className="font-mono text-[9px] text-ink-dim uppercase tracking-widest mb-3">{category}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {guides.map(g => (
                  <Link key={g.slug} to={`/app/help/${g.slug}`}
                    className="bg-brand-surface border border-brand-border rounded-lg p-4 hover:border-primary transition-colors no-underline group flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-sans font-semibold text-sm text-ink group-hover:text-primary transition-colors">{g.title}</div>
                      {!g.published && <span className="font-mono text-[8px] uppercase tracking-wide text-gold bg-gold/10 border border-gold/30 rounded px-1.5 py-0.5 flex-shrink-0">Soon</span>}
                    </div>
                    <p className="font-sans text-[13px] text-ink-muted mt-1 flex-1">{g.summary}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
