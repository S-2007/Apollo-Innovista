// AgentStrip: the three agents (APOLLO, ATHENA, HERMES) with status dot and live label,
// plus the current round and an elapsed timer computed from the first event's timestamp.

import { useEffect, useState, type ReactNode } from 'react'
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

  // The layout follows the width the strip is GIVEN (container queries), not the window: the same
  // strip sits full-width on New Research and in a narrow side column on the Dashboard.
  //   narrow  (< 36rem): one full-width row per agent, then Round | Elapsed as two equal cells
  //   medium  (>= 36rem): three equal agent cards, the two stats below them
  //   wide    (>= 56rem): three equal agent cards and a stats column, all one row
  return (
    <div className="@container">
      <section aria-label="Agents" className="grid grid-cols-1 gap-2 @xl:grid-cols-3 @xl:gap-3 @4xl:grid-cols-[repeat(3,minmax(0,1fr))_9rem]">
        {AGENTS.map((a) => {
          const status = d[a.key]
          return (
            <div
              key={a.key}
              className={`min-w-0 rounded-sm border bg-surface px-4 py-3 ${status === 'active' ? 'pulse-border border-accent/60' : 'border-hair'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} aria-hidden="true" />
                <span className="font-display text-sm font-semibold tracking-[0.14em]">{a.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] uppercase text-muted">{status}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{a.role}</p>
              <p className={`mt-2 truncate font-mono text-xs ${status === 'active' ? 'text-accent-ink' : 'text-muted'}`} aria-live="polite" title={d.labels[a.key]}>
                {d.labels[a.key]}
              </p>
            </div>
          )
        })}
        <div className="grid grid-cols-2 gap-2 @xl:col-span-3 @xl:gap-3 @4xl:col-span-1 @4xl:grid-cols-1 @4xl:gap-0">
          <Stat label="Round" value={<>{d.round || '-'}<span className="text-muted">/{maxRounds}</span></>} />
          <Stat label="Elapsed" value={elapsed === null ? '--:--' : mmss(elapsed)} />
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  // In the wide layout the two stats share one bordered column; otherwise each has its own box.
  return (
    <div className="rounded-sm border border-hair bg-surface px-4 py-3 @4xl:[&:first-child]:rounded-b-none @4xl:[&:first-child]:border-b-0 @4xl:[&:last-child]:rounded-t-none">
      <p className="font-mono text-[11px] uppercase text-muted">{label}</p>
      <p className="font-mono text-lg tabular-nums text-ink">{value}</p>
    </div>
  )
}
