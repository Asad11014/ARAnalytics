import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import clsx from 'clsx'

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS_SHORT  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December']

const EVENT_COLORS = {
  blue:   { bg: 'bg-primary/15',   text: 'text-primary',   dot: 'bg-primary'   },
  green:  { bg: 'bg-success/15',   text: 'text-success',   dot: 'bg-success'   },
  indigo: { bg: 'bg-indigo-500/15',text: 'text-indigo-400',dot: 'bg-indigo-400'},
  gold:   { bg: 'bg-gold/15',      text: 'text-gold',      dot: 'bg-gold'      },
  red:    { bg: 'bg-danger/15',    text: 'text-danger',     dot: 'bg-danger'    },
  purple: { bg: 'bg-purple-500/15',text: 'text-purple-400',dot: 'bg-purple-400'},
}

const EVENT_TYPE_ICONS = {
  meeting:  '📅',
  asn:      '📦',
  orders:   '📤',
  reminder: '🔔',
  deadline: '🚨',
  other:    '📌',
}

const COLOR_OPTIONS = [
  { value: 'blue',   label: 'Blue'   },
  { value: 'green',  label: 'Green'  },
  { value: 'gold',   label: 'Amber'  },
  { value: 'red',    label: 'Red'    },
  { value: 'purple', label: 'Purple' },
  { value: 'indigo', label: 'Indigo' },
]

// ── Date helpers ──────────────────────────────────────────────────────────────

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function parseYmd(str) {
  const [y,m,d] = str.split('-').map(Number)
  return new Date(y, m-1, d)
}

function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d
}

function startOfWeek(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day  // Mon = start
  d.setDate(d.getDate() + diff)
  return d
}

function getMonthGrid(year, month) {
  // Returns rows of 7-day Date arrays for the month view
  const first = new Date(year, month, 1)
  const last  = new Date(year, month + 1, 0)
  const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1  // Mon=0
  const days = []
  for (let i = -startDay; i < last.getDate(); i++) {
    days.push(new Date(year, month, i + 1))
  }
  while (days.length % 7 !== 0) days.push(new Date(year, month + 1, days.length - last.getDate() - startDay + 1))
  const rows = []
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7))
  return rows
}

function getWeekDays(anchorDate) {
  const mon = startOfWeek(anchorDate)
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
}

// ── Event chip ────────────────────────────────────────────────────────────────

function EventChip({ event, onClick, compact = false }) {
  const c = EVENT_COLORS[event.color] || EVENT_COLORS.blue
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(event) }}
      className={clsx(
        'w-full text-left rounded px-1.5 py-0.5 text-[10px] font-medium truncate transition-opacity hover:opacity-80',
        c.bg, c.text,
        compact ? 'py-0' : ''
      )}
      title={event.title}
    >
      {!compact && (
        <span className="mr-1 opacity-70">{EVENT_TYPE_ICONS[event.type] || '📌'}</span>
      )}
      {event.time && !event.allDay ? `${event.time.slice(0,5)} ` : ''}
      {event.title}
      {event.isShared && <span className="ml-1 opacity-50" title="Shared by warehouse">🔗</span>}
    </button>
  )
}

// ── Event detail modal ────────────────────────────────────────────────────────

function EventModal({ event, onClose, onDelete }) {
  const c = EVENT_COLORS[event.color] || EVENT_COLORS.blue
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-brand-surface border border-brand-border rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className={clsx('w-3 h-3 rounded-full flex-shrink-0 mt-1', c.dot)} />
          <div className="flex-1 min-w-0">
            <div className="font-sans font-bold text-base text-ink leading-tight">{event.title}</div>
            <div className="font-mono text-[11px] text-ink-muted mt-0.5">
              {EVENT_TYPE_ICONS[event.type]} {event.type}
              {event.auto && <span className="ml-1 opacity-60">(auto)</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-dim hover:text-ink text-lg leading-none">✕</button>
        </div>

        <div className="space-y-1 font-mono text-xs text-ink-muted">
          <div className="flex gap-2">
            <span className="text-ink-dim w-16">Date</span>
            <span className="text-ink">{event.date}{event.endDate && event.endDate !== event.date ? ` → ${event.endDate}` : ''}</span>
          </div>
          {event.time && (
            <div className="flex gap-2">
              <span className="text-ink-dim w-16">Time</span>
              <span className="text-ink">{event.time.slice(0,5)}{event.endTime ? ` – ${event.endTime.slice(0,5)}` : ''}</span>
            </div>
          )}
          {event.description && (
            <div className="flex gap-2 pt-1">
              <span className="text-ink-dim w-16">Notes</span>
              <span className="text-ink">{event.description}</span>
            </div>
          )}
          {event.createdBy && (
            <div className="flex gap-2">
              <span className="text-ink-dim w-16">By</span>
              <span className="text-ink">{event.createdBy}</span>
            </div>
          )}
          {event.isShared && (
            <div className="flex gap-2 pt-1">
              <span className="font-mono text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded">
                🔗 Shared by warehouse
              </span>
            </div>
          )}
        </div>

        {!event.auto && !event.isShared && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onDelete(event)}
              className="flex-1 border border-danger/40 text-danger font-mono text-xs py-1.5 rounded hover:bg-danger/10 transition-colors"
            >
              Delete event
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Create event modal ────────────────────────────────────────────────────────

function CreateModal({ initialDate, onClose, onSave, isWarehouse, clients }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'meeting',
    date: initialDate || ymd(new Date()),
    time: '',
    endDate: '',
    endTime: '',
    color: 'blue',
    allDay: true,
    sharedClientIds: [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function toggleClient(msId) {
    const id = String(msId)
    setForm(f => ({
      ...f,
      sharedClientIds: f.sharedClientIds.includes(id)
        ? f.sharedClientIds.filter(x => x !== id)
        : [...f.sharedClientIds, id],
    }))
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    try {
      const payload = { ...form }
      if (!isWarehouse) delete payload.sharedClientIds
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to save') }
      const event = await res.json()
      onSave(event)
    } catch(e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-brand-surface border border-brand-border rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-sans font-bold text-base text-ink">New Event</div>
          <button onClick={onClose} className="text-ink-dim hover:text-ink text-lg leading-none">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">Title *</label>
            <input
              autoFocus
              value={form.title}
              onChange={e => set('title', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 text-sm text-ink font-sans focus:outline-none focus:border-primary"
              placeholder="Event title…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}
                className="w-full bg-brand-bg border border-brand-border rounded px-2 py-2 text-sm text-ink font-mono focus:outline-none focus:border-primary">
                <option value="meeting">Meeting</option>
                <option value="asn">ASN / Goods In</option>
                <option value="deadline">Deadline</option>
                <option value="reminder">Reminder</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">Colour</label>
              <div className="flex gap-1.5 pt-1.5">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => set('color', c.value)}
                    title={c.label}
                    className={clsx(
                      'w-5 h-5 rounded-full border-2 transition-transform',
                      EVENT_COLORS[c.value]?.dot,
                      form.color === c.value ? 'border-ink scale-110' : 'border-transparent'
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">Date *</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="w-full bg-brand-bg border border-brand-border rounded px-2 py-2 text-sm text-ink font-mono focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">End date</label>
              <input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)}
                min={form.date}
                className="w-full bg-brand-bg border border-brand-border rounded px-2 py-2 text-sm text-ink font-mono focus:outline-none focus:border-primary" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="allDay" checked={form.allDay} onChange={e => set('allDay', e.target.checked)}
              className="accent-primary" />
            <label htmlFor="allDay" className="font-mono text-xs text-ink-muted cursor-pointer">All day</label>
          </div>

          {!form.allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">Start time</label>
                <input type="time" value={form.time} onChange={e => set('time', e.target.value)}
                  className="w-full bg-brand-bg border border-brand-border rounded px-2 py-2 text-sm text-ink font-mono focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">End time</label>
                <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)}
                  className="w-full bg-brand-bg border border-brand-border rounded px-2 py-2 text-sm text-ink font-mono focus:outline-none focus:border-primary" />
              </div>
            </div>
          )}

          {/* Client sharing — warehouse users only */}
          {isWarehouse && clients && clients.length > 0 && (
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">
                Share with clients
              </label>
              <div className="max-h-28 overflow-y-auto border border-brand-border rounded bg-brand-bg p-2 space-y-1">
                {[...clients]
                  .sort((a, b) => (a.Name || a.name || '').localeCompare(b.Name || b.name || ''))
                  .map(c => {
                    const msId   = String(c.ID || c.id)
                    const label  = c.Name || c.name || msId
                    const checked = form.sharedClientIds.includes(msId)
                    return (
                      <label key={msId} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleClient(msId)}
                          className="accent-primary"
                        />
                        <span className={clsx(
                          'font-sans text-xs transition-colors',
                          checked ? 'text-primary font-medium' : 'text-ink-muted group-hover:text-ink'
                        )}>
                          {label}
                        </span>
                      </label>
                    )
                  })}
              </div>
              {form.sharedClientIds.length > 0 && (
                <p className="font-mono text-[9px] text-primary mt-1">
                  {form.sharedClientIds.length} client(s) will see this event
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-1">Notes</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2}
              className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 text-sm text-ink font-sans focus:outline-none focus:border-primary resize-none"
              placeholder="Optional notes…" />
          </div>
        </div>

        {error && <p className="font-mono text-xs text-danger">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 border border-brand-border text-ink-muted font-mono text-xs py-2 rounded hover:bg-brand-surface2 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs py-2 rounded transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save event'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({ year, month, eventsByDate, today, onDayClick, onEventClick }) {
  const grid = getMonthGrid(year, month)
  const todayStr = ymd(today)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-brand-border">
        {DAYS_SHORT.map(d => (
          <div key={d} className="py-2 text-center font-mono text-[10px] uppercase tracking-widest text-ink-dim">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 grid grid-rows-[repeat(6,1fr)] min-h-0">
        {grid.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-brand-border last:border-b-0">
            {week.map((date, di) => {
              const dateStr  = ymd(date)
              const isToday  = dateStr === todayStr
              const isCurMo  = date.getMonth() === month
              const dayEvts  = eventsByDate[dateStr] || []
              const MAX_SHOW = 3

              return (
                <div
                  key={di}
                  onClick={() => onDayClick(dateStr)}
                  className={clsx(
                    'relative p-1.5 border-r border-brand-border last:border-r-0 cursor-pointer transition-colors min-h-[80px]',
                    isCurMo ? 'bg-brand-surface hover:bg-brand-surface2' : 'bg-brand-bg hover:bg-brand-surface',
                    'group'
                  )}
                >
                  {/* Date number */}
                  <div className={clsx(
                    'w-6 h-6 flex items-center justify-center rounded-full font-mono text-xs mb-1 font-semibold',
                    isToday  ? 'bg-primary text-white'
                    : isCurMo ? 'text-ink'
                    : 'text-ink-dim'
                  )}>
                    {date.getDate()}
                  </div>

                  {/* Event chips */}
                  <div className="space-y-0.5">
                    {dayEvts.slice(0, MAX_SHOW).map(ev => (
                      <EventChip key={ev.id} event={ev} onClick={onEventClick} compact />
                    ))}
                    {dayEvts.length > MAX_SHOW && (
                      <div className="font-mono text-[9px] text-ink-dim px-1">
                        +{dayEvts.length - MAX_SHOW} more
                      </div>
                    )}
                  </div>

                  {/* Add event hint on hover */}
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[10px] text-ink-dim font-mono">+</span>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Week view ─────────────────────────────────────────────────────────────────

function WeekView({ anchorDate, eventsByDate, today, onDayClick, onEventClick }) {
  const days    = getWeekDays(anchorDate)
  const todayStr = ymd(today)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header row */}
      <div className="grid grid-cols-7 border-b border-brand-border">
        {days.map((date, i) => {
          const isToday = ymd(date) === todayStr
          return (
            <div key={i} className={clsx(
              'py-3 text-center border-r border-brand-border last:border-r-0',
              isToday && 'bg-primary/5'
            )}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">{DAYS_SHORT[i]}</div>
              <div className={clsx(
                'mx-auto mt-1 w-8 h-8 flex items-center justify-center rounded-full font-mono text-sm font-bold',
                isToday ? 'bg-primary text-white' : 'text-ink'
              )}>
                {date.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Event columns */}
      <div className="flex-1 grid grid-cols-7 min-h-0 overflow-y-auto">
        {days.map((date, i) => {
          const dateStr = ymd(date)
          const isToday = dateStr === todayStr
          const dayEvts = eventsByDate[dateStr] || []

          return (
            <div
              key={i}
              onClick={() => onDayClick(dateStr)}
              className={clsx(
                'border-r border-brand-border last:border-r-0 p-2 cursor-pointer transition-colors',
                isToday ? 'bg-primary/5 hover:bg-primary/10' : 'bg-brand-surface hover:bg-brand-surface2',
                'min-h-[120px]'
              )}
            >
              <div className="space-y-1">
                {dayEvts.length === 0 && (
                  <div className="font-mono text-[10px] text-ink-dim text-center mt-4 opacity-50">—</div>
                )}
                {dayEvts.map(ev => (
                  <EventChip key={ev.id} event={ev} onClick={onEventClick} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Calendar page ────────────────────────────────────────────────────────

export default function Calendar() {
  const { session, warehouseId } = useSession()
  const location = useLocation()

  const today = new Date()
  const initialDate = (() => {
    const param = new URLSearchParams(location.search).get('date')
    if (param) { const d = parseYmd(param); if (!isNaN(d)) return d }
    return today
  })()

  const [view,   setView]   = useState('month')
  const [anchor, setAnchor] = useState(initialDate)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)

  const [createDate,    setCreateDate]    = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [syncState,     setSyncState]     = useState('idle')  // 'idle'|'syncing'|'done'|'error'

  const year  = anchor.getFullYear()
  const month = anchor.getMonth()

  // Build date→events map
  const eventsByDate = {}
  for (const ev of events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = []
    eventsByDate[ev.date].push(ev)
    // For multi-day events also add to end date
    if (ev.endDate && ev.endDate !== ev.date) {
      if (!eventsByDate[ev.endDate]) eventsByDate[ev.endDate] = []
      eventsByDate[ev.endDate].push(ev)
    }
  }

  // Compute visible date range for API fetch
  function visibleRange() {
    if (view === 'month') {
      const first = new Date(year, month, 1)
      const last  = new Date(year, month + 1, 0)
      // Pad to full weeks
      const from = addDays(first, -(first.getDay() === 0 ? 6 : first.getDay() - 1))
      const to   = addDays(last,  7 - (last.getDay() === 0 ? 7 : last.getDay()))
      return { from: ymd(from), to: ymd(to) }
    } else {
      const days = getWeekDays(anchor)
      return { from: ymd(days[0]), to: ymd(days[6]) }
    }
  }

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = visibleRange()
      const res = await fetch(`/api/calendar?from=${from}&to=${to}`)
      if (!res.ok) throw new Error('Failed to load events')
      const data = await res.json()
      setEvents(data.events || [])
    } catch(e) {
      console.error('Calendar load error:', e)
    } finally {
      setLoading(false)
    }
  }, [view, year, month, anchor])  // eslint-disable-line

  useEffect(() => { loadEvents() }, [loadEvents])

  function navigate(dir) {
    setAnchor(a => {
      if (view === 'month') {
        const d = new Date(a)
        d.setMonth(d.getMonth() + dir)
        return d
      } else {
        return addDays(a, dir * 7)
      }
    })
  }

  function headerLabel() {
    if (view === 'month') return `${MONTHS[month]} ${year}`
    const days = getWeekDays(anchor)
    const s = days[0], e = days[6]
    if (s.getMonth() === e.getMonth()) {
      return `${s.getDate()} – ${e.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`
    }
    return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`
  }

  function handleDayClick(dateStr) {
    setCreateDate(dateStr)
  }

  function handleEventSaved(newEvent) {
    setEvents(evs => [...evs, newEvent])
    setCreateDate(null)
  }

  async function handleSyncAsn() {
    setSyncState('syncing')
    try {
      const res = await fetch('/api/calendar/sync-asn', { method: 'POST' })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Sync failed') }
      setSyncState('done')
      setTimeout(() => setSyncState('idle'), 4000)
      // Reload calendar events to pick up new GoodsIn data
      loadEvents()
    } catch (e) {
      console.error('ASN sync error:', e)
      setSyncState('error')
      setTimeout(() => setSyncState('idle'), 4000)
    }
  }

  async function handleDeleteEvent(event) {
    try {
      await fetch(`/api/calendar/${event.id}`, { method: 'DELETE' })
      setEvents(evs => evs.filter(e => e.id !== event.id))
      setSelectedEvent(null)
    } catch(e) {
      console.error('Delete error:', e)
    }
  }

  // Today's events for the sidebar
  const todayEvts = eventsByDate[ymd(today)] || []

  // Upcoming events (next 7 days, excluding today)
  const upcoming = []
  for (let i = 1; i <= 14; i++) {
    const d = ymd(addDays(today, i))
    const evts = eventsByDate[d] || []
    if (evts.length) upcoming.push({ date: d, evts })
    if (upcoming.length >= 4) break
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-brand-bg">

      {/* Top bar */}
      <header className="bg-brand-surface border-b border-brand-border px-4 sm:px-6 h-14 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="flex items-center gap-4">
          {/* Navigation */}
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)}
              className="w-8 h-8 flex items-center justify-center rounded border border-brand-border text-ink-muted hover:text-ink hover:border-primary transition-colors font-mono text-sm">
              ‹
            </button>
            <button onClick={() => setAnchor(new Date())}
              className="px-3 h-8 rounded border border-brand-border font-mono text-xs text-ink-muted hover:text-ink hover:border-primary transition-colors">
              Today
            </button>
            <button onClick={() => navigate(1)}
              className="w-8 h-8 flex items-center justify-center rounded border border-brand-border text-ink-muted hover:text-ink hover:border-primary transition-colors font-mono text-sm">
              ›
            </button>
          </div>

          <h1 className="font-sans font-bold text-base sm:text-lg text-ink">{headerLabel()}</h1>
          {loading && <div className="w-4 h-4 border-2 border-brand-border border-t-primary rounded-full animate-spin" />}
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded border border-brand-border overflow-hidden">
            {['month', 'week'].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={clsx(
                  'px-3 py-1.5 font-mono text-xs capitalize transition-colors',
                  view === v ? 'bg-primary text-white' : 'text-ink-muted hover:bg-brand-surface2 hover:text-ink'
                )}>
                {v}
              </button>
            ))}
          </div>

          {/* ASN sync — warehouse only */}
          {session?.isWarehouse && (
            <button
              onClick={handleSyncAsn}
              disabled={syncState === 'syncing'}
              className={clsx(
                'flex items-center gap-1.5 border rounded font-mono text-xs px-3 py-2 transition-colors disabled:opacity-50',
                syncState === 'done'    ? 'border-success text-success'
                : syncState === 'error' ? 'border-danger text-danger'
                : 'border-brand-border text-ink-muted hover:border-primary hover:text-primary'
              )}
            >
              {syncState === 'syncing' ? '⟳ Syncing…'
                : syncState === 'done' ? '✓ Synced'
                : syncState === 'error' ? '✕ Failed'
                : '⟳ Sync ASN'}
            </button>
          )}

          {/* New event */}
          <button
            onClick={() => setCreateDate(ymd(today))}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-white font-sans font-bold text-xs rounded px-3 py-2 transition-colors"
          >
            <span className="text-sm leading-none">+</span>
            <span className="hidden sm:inline">New Event</span>
          </button>
        </div>
      </header>

      {/* Body: calendar + sidebar */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Calendar area */}
        <div className="flex-1 flex flex-col min-h-0 overflow-auto">
          {view === 'month' ? (
            <MonthView
              year={year} month={month}
              eventsByDate={eventsByDate} today={today}
              onDayClick={handleDayClick} onEventClick={setSelectedEvent}
            />
          ) : (
            <WeekView
              anchorDate={anchor}
              eventsByDate={eventsByDate} today={today}
              onDayClick={handleDayClick} onEventClick={setSelectedEvent}
            />
          )}
        </div>

        {/* Right sidebar — today + upcoming */}
        <div className="w-56 flex-shrink-0 border-l border-brand-border bg-brand-surface flex-col hidden xl:flex">
          <div className="p-4 space-y-4 overflow-y-auto flex-1">

            {/* Today */}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-2">Today</div>
              {todayEvts.length === 0 ? (
                <p className="font-mono text-[11px] text-ink-dim">No events today</p>
              ) : (
                <div className="space-y-1">
                  {todayEvts.map(ev => (
                    <EventChip key={ev.id} event={ev} onClick={setSelectedEvent} />
                  ))}
                </div>
              )}
            </div>

            {upcoming.length > 0 && (
              <>
                <div className="h-px bg-brand-border" />
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-2">Upcoming</div>
                  <div className="space-y-3">
                    {upcoming.map(({ date, evts }) => {
                      const d = parseYmd(date)
                      return (
                        <div key={date}>
                          <div className="font-mono text-[9px] text-ink-muted mb-1">
                            {DAYS_SHORT[(d.getDay() + 6) % 7]} {d.getDate()} {MONTHS[d.getMonth()].slice(0,3)}
                          </div>
                          <div className="space-y-0.5">
                            {evts.slice(0,3).map(ev => (
                              <EventChip key={ev.id} event={ev} onClick={setSelectedEvent} compact />
                            ))}
                            {evts.length > 3 && <div className="font-mono text-[9px] text-ink-dim pl-1">+{evts.length-3} more</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            <div className="h-px bg-brand-border" />

            {/* Legend */}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-ink-dim mb-2">Event types</div>
              <div className="space-y-1">
                {Object.entries(EVENT_TYPE_ICONS).map(([type, icon]) => (
                  <div key={type} className="flex items-center gap-2 font-mono text-[11px] text-ink-muted capitalize">
                    <span>{icon}</span>{type.replace('-',' ')}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {createDate && (
        <CreateModal
          initialDate={createDate}
          onClose={() => setCreateDate(null)}
          onSave={handleEventSaved}
          isWarehouse={session?.isWarehouse}
          clients={session?.clients || []}
        />
      )}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDelete={handleDeleteEvent}
        />
      )}
    </div>
  )
}
