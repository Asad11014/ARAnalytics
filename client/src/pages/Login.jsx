import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { setSession, setWarehouseId } = useSession()
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Please enter your username and password.'); return }

    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: username.trim(), password })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed. Please try again.'); return }

      setSession(data)
      const whs = data.warehouses || []
      if (whs.length === 1) setWarehouseId(String(whs[0].ID))
      navigate('/app')
    } catch {
      setError('Could not connect to server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: '#f5f6fa',
        backgroundImage: 'linear-gradient(rgba(31,34,172,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(31,34,172,0.04) 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }}
    >
      <div className="bg-brand-surface border border-brand-border rounded-xl shadow-modal w-full max-w-[420px] mx-4 p-10">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 bg-primary rounded-lg flex items-center justify-center text-white font-extrabold text-base flex-shrink-0">
            AR
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-ink leading-tight">ARAnalytics</h1>
            <p className="font-mono text-[10px] text-ink-muted tracking-wide mt-0.5 uppercase">
              Powered by Mintsoft
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">
              Mintsoft Username
            </label>
            <input
              type="text"
              autoComplete="username"
              placeholder="your@email.com"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
              className="bg-brand-bg border border-brand-border rounded px-3.5 py-2.5 font-mono text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] text-ink-muted uppercase tracking-wide">
              Mintsoft Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              className="bg-brand-bg border border-brand-border rounded px-3.5 py-2.5 font-mono text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-60"
            />
          </div>

          {error && (
            <div className="bg-danger/5 border border-danger/25 rounded text-danger font-mono text-xs px-3.5 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-hover text-white font-sans font-bold text-sm rounded py-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="font-mono text-[11px] text-ink-muted text-center mt-5 leading-relaxed">
          Use your Mintsoft login credentials.<br />
          Your password is never stored.
        </p>
      </div>
    </div>
  )
}
