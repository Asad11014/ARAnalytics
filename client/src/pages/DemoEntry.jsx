import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'

// Entry point for the public demo (linked from the marketing site).
// Starts a read-only demo session, then drops the visitor into the app.
export default function DemoEntry() {
  const { setSession, setWarehouseId } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return   // guard against React 18 StrictMode double-run
    started.current = true

    ;(async () => {
      try {
        const res  = await fetch('/api/demo-login', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) { setError(data.error || 'Demo is unavailable right now.'); return }

        setSession(data)
        const whs = data.warehouses || []
        if (whs.length >= 1) setWarehouseId(String(whs[0].ID))
        navigate('/app', { replace: true })
      } catch {
        setError('Could not connect to the demo server.')
      }
    })()
  }, [setSession, setWarehouseId, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        {error ? (
          <>
            <span className="font-mono text-sm text-danger">{error}</span>
            <a href="/" className="font-mono text-xs text-primary hover:underline">← Back to login</a>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-brand-border border-t-primary rounded-full animate-spin" />
            <span className="font-mono text-xs text-ink-muted">Preparing your demo…</span>
          </>
        )}
      </div>
    </div>
  )
}
