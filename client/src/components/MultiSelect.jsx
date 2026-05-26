import { useState, useRef, useEffect, useCallback } from 'react'
import clsx from 'clsx'

// Reusable checkbox dropdown — label is the placeholder label shown when nothing or everything is selected.
// options: [{ value, label }]
// value: Set of selected values (or [] to mean "all")
// onChange: (newSet) => void
export default function MultiSelect({ label, options, value, onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const allSelected  = value.size === 0 || value.size === options.length
  const noneSelected = value.size === 0

  const toggle = useCallback((v) => {
    const next = new Set(value)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    // If everything is checked, treat as "all" (empty set = no filter)
    onChange(next.size === options.length ? new Set() : next)
  }, [value, options.length, onChange])

  const selectAll  = () => onChange(new Set())
  const clearAll   = () => onChange(new Set(options.map(o => o.value)))

  const displayLabel = allSelected
    ? label
    : value.size === 1
      ? options.find(o => value.has(o.value))?.label ?? label
      : `${value.size} selected`

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'flex items-center gap-1.5 border rounded font-mono text-[11px] px-2 py-1 transition-colors bg-brand-bg whitespace-nowrap',
          !allSelected
            ? 'border-primary text-primary'
            : 'border-brand-border text-ink-muted hover:border-primary hover:text-primary'
        )}
      >
        <span className="truncate max-w-[130px]">{displayLabel}</span>
        <span className={clsx('ml-auto transition-transform duration-150 flex-shrink-0', open && 'rotate-180')}>▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-brand-surface border border-brand-border rounded shadow-lg min-w-[180px] max-w-[260px] max-h-[280px] flex flex-col">
          {/* Actions */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-brand-border flex-shrink-0">
            <button onClick={selectAll}
              className="font-mono text-[10px] text-primary hover:underline">All</button>
            <span className="text-brand-border">·</span>
            <button onClick={clearAll}
              className="font-mono text-[10px] text-ink-muted hover:text-danger hover:underline">None</button>
            <span className="ml-auto font-mono text-[10px] text-ink-dim">
              {allSelected ? 'all' : `${value.size}/${options.length}`}
            </span>
          </div>

          {/* Options */}
          <div className="overflow-y-auto">
            {options.map(opt => {
              const checked = allSelected || value.has(opt.value)
              return (
                <label key={opt.value}
                  className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-brand-surface2 transition-colors">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.value)}
                    className="accent-primary w-3.5 h-3.5 flex-shrink-0"
                  />
                  <span className="font-mono text-[11px] text-ink truncate">{opt.label}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
