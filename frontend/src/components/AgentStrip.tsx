// AgentStrip: the three agents (APOLLO, ATHENA, HERMES) with status dot and live label,
// plus the current round and an elapsed timer computed from the first event's timestamp.

import { useEffect, useState } from 'react'
import type { AgentStatus, Derived } from '../derive'

const AGENTS = [
  { key: 'apollo', name: 'APOLLO', role: 'Plans · writes' },
  { key: 'athena', name: 'ATHENA', role: 'Searches' },
  { key: 'hermes', name: 'HERMES', role: 'Reviews' },
] as const

const DOT: Record<AgentStatus, string> = {
  idle: 'bg-muted/40',
  active: 'bg-accent-strong',
  done: 'bg-ok',
  error: 'bg-err',
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function AgentStrip({ d, maxRounds }: { d: Derived; maxRounds: number }) {
  const [now, setNow] = useState(() => Date.now())
  const ticking = d.startMs !== null && !d.finished
  useEffect(() => {
    if (!ticking) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [ticking])

  const elapsed = d.startMs === null ? null : (d.endMs ?? now) - d.startMs

  return (
    <section aria-label="Agents" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
      {AGENTS.map((a) => {
        const status = d[a.key]
        return (
          <div
            key={a.key}
            className={`rounded-sm border bg-surface px-4 py-3 ${status === 'active' ? 'pulse-border border-accent/60' : 'border-hair'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} aria-hidden="true" />
              <span className="font-display text-sm font-semibold tracking-[0.14em]">{a.name}</span>
              <span className="ml-auto font-mono text-[11px] uppercase text-muted">{status}</span>
            </div>
            <p className="mt-1 text-xs text-muted">{a.role}</p>
            <p className={`mt-2 truncate font-mono text-xs ${status === 'active' ? 'text-accent-ink' : 'text-muted'}`} aria-live="polite">
              {d.labels[a.key]}
            </p>
          </div>
        )
      })}
      <div className="flex gap-6 rounded-sm border border-hair bg-surface px-4 py-3 sm:col-span-3 lg:col-span-1 lg:flex-col lg:gap-2">
        <div>
          <p className="font-mono text-[11px] uppercase text-muted">Round</p>
          <p className="font-mono text-lg tabular-nums text-ink">
            {d.round || '-'}
            <span className="text-muted">/{maxRounds}</span>
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase text-muted">Elapsed</p>
          <p className="font-mono text-lg tabular-nums text-ink">{elapsed === null ? '--:--' : mmss(elapsed)}</p>
        </div>
      </div>
    </section>
  )
}
