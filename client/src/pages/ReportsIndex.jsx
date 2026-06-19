import { Link } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { CLIENT_REPORT_GROUPS } from '../lib/nav'

// Landing page for Stock Analytics → Reports. Lists every available report
// grouped by its sub-category; clicking one opens that report.
export default function ReportsIndex() {
  const { session } = useSession()
  const isWarehouse = session?.isWarehouse

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center sticky top-0 z-40">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">Reports</div>
          <div className="font-mono text-[11px] text-ink-muted hidden sm:block">
            Choose a report to open
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-7 space-y-8 max-w-5xl">
        {CLIENT_REPORT_GROUPS.map(group => (
          <section key={group.id}>
            <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">
              ▸ {group.label}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.items.map(item => {
                const label = (!isWarehouse && item.clientLabel) ? item.clientLabel : item.label
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="group bg-brand-surface border border-brand-border rounded-lg p-4 flex items-center gap-3 hover:border-primary hover:shadow-card-hover transition-all no-underline"
                  >
                    <span className="text-2xl flex-shrink-0">{item.icon}</span>
                    <div className="min-w-0">
                      <div className="font-sans font-semibold text-sm text-ink group-hover:text-primary transition-colors truncate">
                        {label}
                      </div>
                      <div className="font-mono text-[10px] text-ink-muted">Open report →</div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
