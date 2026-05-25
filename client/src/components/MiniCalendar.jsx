import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const DAYS   = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const TYPE_DOT = {
  meeting:  'bg-primary',
  asn:      'bg-success',
  orders:   'bg-indigo-400',
  reminder: 'bg-gold',
  deadline: 'bg-danger',
  other:    'bg-ink-muted',
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function getMonthGrid(year, month) {
  const first    = new Date(year, month, 1)
  const last     = new Date(year, month + 1, 0)
  const startDay = first.getDay() === 0 ? 6 : first.getDay() - 1
  const days     = []
  for (let i = -startDay; i < last.getDate(); i++) days.push(new Date(year, month, i + 1))
  while (days.length % 7 !== 0) days.push(new Date(year, month + 1, days.length - last.getDate() - startDay + 1))
  const rows = []
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7))
  return rows
}

export default function MiniCalendar() {
  const navigate   = useNavigate()
  const today      = new Date()
  const todayStr   = ymd(today)
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [eventMap,  setEventMap]  = useState({})

  useEffect(() => {
    const from    = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate()
    const to      = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    fetch(`/api/calendar?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(({ events = [] }) => {
        const map = {}
        for (const ev of events) {
          if (!map[ev.date]) map[ev.date] = []
          map[ev.date].push(ev)
        }
        setEventMap(map)
      })
      .catch(() => {})
  }, [viewYear, viewMonth])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const rows = getMonthGrid(viewYear, viewMonth)

  const upcoming = Object.entries(eventMap)
    .filter(([d]) => d >= todayStr)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, evs]) => evs)
    .slice(0, 3)

  return (
    <div className="bg-brand-surface border border-brand-border rounded-lg p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] text-primary uppercase tracking-widest">▸ Calendar</div>
        <button
          onClick={() => navigate('/app/calendar')}
          className="font-mono text-[10px] text-ink-muted hover:text-primary transition-colors"
        >
          View full →
        </button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="w-6 h-6 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-brand-surface2 rounded transition-colors text-sm font-bold"
        >
          ‹
        </button>
        <span className="font-sans font-bold text-[13px] text-ink">
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          className="w-6 h-6 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-brand-surface2 rounded transition-colors text-sm font-bold"
        >
          ›
        </button>
      </div>

      {/* Day grid */}
      <div>
        <div className="grid grid-cols-7 mb-1.5">
          {DAYS.map(d => (
            <div key={d} className="text-center font-mono text-[9px] text-ink-dim uppercase">{d}</div>
          ))}
        </div>
        {rows.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((date, di) => {
              const str      = ymd(date)
              const isToday  = str === todayStr
              const isCurMo  = date.getMonth() === viewMonth
              const events   = eventMap[str] || []
              return (
                <div
                  key={di}
                  onClick={() => navigate(`/app/calendar?date=${str}`)}
                  className={`flex flex-col items-center py-0.5 cursor-pointer rounded transition-colors ${isCurMo ? 'hover:bg-brand-surface2' : ''}`}
                >
                  <span className={`w-6 h-6 flex items-center justify-center text-[11px] font-mono rounded-full transition-colors
                    ${isToday ? 'bg-primary text-white font-bold' : isCurMo ? 'text-ink' : 'text-ink-dim opacity-40'}`}>
                    {date.getDate()}
                  </span>
                  <div className="flex gap-0.5 mt-0.5 h-1 items-center">
                    {events.slice(0, 3).map((ev, i) => (
                      <div key={i} className={`w-1 h-1 rounded-full ${TYPE_DOT[ev.type] || 'bg-ink-muted'}`} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Upcoming events */}
      <div className="border-t border-brand-border pt-2.5 space-y-1.5">
        <div className="font-mono text-[8px] text-ink-dim uppercase tracking-widest mb-1">Upcoming</div>
        {upcoming.length === 0 ? (
          <div className="font-mono text-[10px] text-ink-dim py-1">No upcoming events</div>
        ) : upcoming.map((ev, i) => (
          <div
            key={i}
            onClick={() => navigate('/app/calendar')}
            className="flex items-start gap-2 cursor-pointer group"
          >
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${TYPE_DOT[ev.type] || 'bg-ink-muted'}`} />
            <div className="min-w-0">
              <div className="font-sans text-[11px] text-ink group-hover:text-primary transition-colors truncate leading-tight">{ev.title}</div>
              <div className="font-mono text-[9px] text-ink-muted">{ev.date}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
