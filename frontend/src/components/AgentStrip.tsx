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
  idle: 'bg-zinc-600',
  active: 'bg-accent',
  done: 'bg-emerald-400',
  error: 'bg-amber-400',
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
            className={`rounded-lg border bg-white/[0.03] px-4 py-3 ${status === 'active' ? 'pulse-border border-accent/60' : 'border-white/10'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} aria-hidden="true" />
              <span className="font-display text-sm font-semibold tracking-[0.14em]">{a.name}</span>
              <span className="ml-auto font-mono text-[11px] uppercase text-zinc-400">{status}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">{a.role}</p>
            <p className={`mt-2 truncate font-mono text-xs ${status === 'active' ? 'text-accent' : 'text-zinc-300'}`} aria-live="polite">
              {d.labels[a.key]}
            </p>
          </div>
        )
      })}
      <div className="flex gap-6 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 sm:col-span-3 lg:col-span-1 lg:flex-col lg:gap-2">
        <div>
          <p className="font-mono text-[11px] uppercase text-zinc-400">Round</p>
          <p className="font-mono text-lg tabular-nums text-zinc-100">
            {d.round || '-'}
            <span className="text-zinc-400">/{maxRounds}</span>
          </p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase text-zinc-400">Elapsed</p>
          <p className="font-mono text-lg tabular-nums text-zinc-100">{elapsed === null ? '--:--' : mmss(elapsed)}</p>
        </div>
      </div>
    </section>
  )
}
