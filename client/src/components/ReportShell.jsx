// Shared shell for all report pages.
// Provides the sticky header, params panel, status bar, and stat cards row.
// Pages compose their own table/chart content as children.

import StatusBar  from './StatusBar'
import { exportCSV } from '../lib/api'

export default function ReportShell({ title, subtitle, params, onRun, loading, rows, columns, exportName, children }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-7 min-h-[52px] flex items-center justify-between sticky top-0 z-40 gap-2">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">{title}</div>
          {subtitle && <div className="font-mono text-[11px] text-ink-muted hidden sm:block">{subtitle}</div>}
        </div>
        {rows?.length > 0 && columns && exportName && (
          <button
            onClick={() => exportCSV(exportName, columns, rows)}
            className="flex-shrink-0 border border-brand-border rounded text-ink-muted font-mono text-[11px] px-3 py-1.5 hover:border-gold hover:text-gold transition-colors"
          >
            Export CSV
          </button>
        )}
      </header>

      <div className="p-4 sm:p-7 space-y-5">
        {params && (
          <div className="bg-brand-surface border border-brand-border rounded-lg px-4 sm:px-6 py-3 sm:py-4">
            <div className="font-mono text-[9px] text-primary uppercase tracking-widest mb-3">▸ Parameters</div>
            <div className="flex gap-3 items-end flex-wrap">
              {params}
              <button onClick={onRun} disabled={loading}
                className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded px-5 py-2 h-9 transition-colors disabled:opacity-50">
                {loading ? '⟳ Running…' : '▶ Run Report'}
              </button>
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  )
}
