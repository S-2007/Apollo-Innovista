// Accounts on the client: AuthGate asks the backend who is signed in (GET /api/auth/me) and shows
// either the sign-in / create-account screen or the app. Any API call that gets 401 fires
// SIGNED_OUT_EVENT, which returns the user to the sign-in screen. The JWT itself stays in an
// HttpOnly cookie that this code cannot read.

import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { SIGNED_OUT_EVENT, authLogin, authLogout, authMe, authRegister, type AuthUser } from './api'
import { btn, field } from './ui'

interface AuthState {
  user: AuthUser
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const s = useContext(Ctx)
  if (!s) throw new Error('useAuth outside AuthGate')
  return s
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined) // undefined = still checking
  const [offline, setOffline] = useState<string | null>(null)

  useEffect(() => {
    authMe()
      .then(setUser)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : ''
        if (msg.startsWith('Cannot reach')) setOffline(msg)
        setUser(null)
      })
    const out = () => setUser(null)
    window.addEventListener(SIGNED_OUT_EVENT, out)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, out)
  }, [])

  if (user === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-app font-mono text-xs text-muted" role="status">Checking your session…</div>
  }
  if (user === null) return <AuthScreen onSignedIn={(u) => { setOffline(null); setUser(u) }} notice={offline} />

  const signOut = async () => {
    await authLogout().catch(() => undefined)
    setUser(null)
  }
  // key: a different account gets a fresh app state (no previous user's run in memory)
  return <Ctx.Provider value={{ user, signOut }}><div key={user.id}>{children}</div></Ctx.Provider>
}

type Mode = 'signin' | 'register'

function AuthScreen({ onSignedIn, notice }: { onSignedIn: (u: AuthUser) => void; notice: string | null }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(notice)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === 'register' && password.length < 8) return setError('Password must be at least 8 characters.')
    setBusy(true)
    try {
      onSignedIn(mode === 'signin' ? await authLogin(email, password) : await authRegister(name, email, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const switchTo = (m: Mode) => {
    setMode(m)
    setError(null)
  }

  return (
    <div className="flex min-h-screen bg-app">
      <aside className="hidden w-[44%] flex-col justify-between border-r border-line bg-surface p-10 lg:flex">
        <div>
          <p className="font-display text-[28px] font-bold leading-none tracking-[0.22em] text-ink">APOLLO</p>
          <p className="label mt-2">Multi-agent research</p>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-[30px] font-semibold leading-tight">Research answers built only from retrieved sources.</h1>
          <ul className="mt-5 space-y-2 text-sm text-muted">
            <li>· Every claim carries a citation to a real URL.</li>
            <li>· Each claim is checked against the source text.</li>
            <li>· What could not be verified is listed, not hidden.</li>
          </ul>
        </div>
        <p className="font-mono text-[11px] text-muted">Apollo plans · Athena searches · Hermes reviews</p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <p className="font-display text-[22px] font-bold tracking-[0.22em] lg:hidden">APOLLO</p>
          <div role="tablist" aria-label="Account" className="mt-6 grid grid-cols-2 border border-line bg-surface lg:mt-0">
            {(['signin', 'register'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchTo(m)}
                className={`py-2 font-mono text-[11px] uppercase tracking-wide ${mode === m ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-4 space-y-4 border border-line bg-surface p-6" noValidate>
            <div>
              <h2 className="font-display text-xl font-semibold">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
              <p className="mt-0.5 text-sm text-muted">{mode === 'signin' ? 'Sign in to continue your research.' : 'Your research sessions stay private to your account.'}</p>
            </div>
            {mode === 'register' && (
              <div>
                <label htmlFor="name" className="label">Name</label>
                <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className={`${field} mt-1.5`} />
              </div>
            )}
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} mt-1.5`} />
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="label">Password</label>
                <button type="button" onClick={() => setShow((v) => !v)} className="font-mono text-[11px] text-accent-ink hover:underline" aria-controls="password">
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={mode === 'register' ? 'pw-hint' : undefined}
                className={`${field} mt-1.5`}
              />
              {mode === 'register' && <p id="pw-hint" className="mt-1 text-[11px] text-muted">At least 8 characters.</p>}
            </div>
            {error && <p role="alert" className="border border-err/50 bg-err/10 px-3 py-2 text-sm text-err-ink">{error}</p>}
            <button type="submit" disabled={busy || !email || !password || (mode === 'register' && !name.trim())} className={`${btn.primary} w-full`}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            <p className="text-center text-sm text-muted">
              {mode === 'signin' ? 'New to APOLLO? ' : 'Already have an account? '}
              <button type="button" onClick={() => switchTo(mode === 'signin' ? 'register' : 'signin')} className="text-accent-ink hover:underline">
                {mode === 'signin' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          </form>
        </div>
      </main>
    </div>
  )
}
