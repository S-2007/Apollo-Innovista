// Who did what: the three agents (plus "you" and the verifier) with their colour
// and icon, the event → actor mapping used by the feed, and the Apollo mark.

import { BadgeCheck, Compass, ScanSearch, Search, TriangleAlert, UserRound, type LucideIcon } from 'lucide-react'
import type { RunEvent } from './api'

export type Actor = 'apollo' | 'athena' | 'hermes' | 'you' | 'verify' | 'warning'

export const ACTORS: Record<Actor, { name: string; role: string; Icon: LucideIcon; text: string; soft: string; solid: string }> = {
  apollo: { name: 'Apollo', role: 'plans and writes', Icon: Compass, text: 'text-apollo', soft: 'bg-apollo-soft', solid: 'bg-apollo' },
  athena: { name: 'Athena', role: 'searches the web', Icon: Search, text: 'text-athena', soft: 'bg-athena-soft', solid: 'bg-athena' },
  hermes: { name: 'Hermes', role: 'reviews gaps and conflicts', Icon: ScanSearch, text: 'text-hermes', soft: 'bg-hermes-soft', solid: 'bg-hermes' },
  you: { name: 'You', role: 'approve and edit', Icon: UserRound, text: 'text-slate-700', soft: 'bg-slate-100', solid: 'bg-slate-700' },
  verify: { name: 'Verifier', role: 'checks claims against sources', Icon: BadgeCheck, text: 'text-emerald-700', soft: 'bg-emerald-50', solid: 'bg-emerald-600' },
  warning: { name: 'Warning', role: '', Icon: TriangleAlert, text: 'text-amber-800', soft: 'bg-amber-50', solid: 'bg-amber-500' },
}

export function actorOf(e: RunEvent): Actor {
  switch (e.type) {
    case 'plan':
      return e.data.pending ? 'you' : 'apollo'
    case 'search_started':
    case 'search_done':
      return 'athena'
    case 'search_failed':
    case 'error':
      return 'warning'
    case 'review':
      if (e.data.gaps_decision) return 'you'
      if (e.data.stop_reason) return 'apollo'
      return 'hermes'
    case 'gaps_pending':
      return 'you'
    case 'contradictions':
      return 'hermes'
    case 'verification':
      return 'verify'
    default:
      return 'apollo'
  }
}

/** The mark: one orbit, three agents on it. */
export function ApolloMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <circle cx="16" cy="5" r="3.2" fill="var(--color-apollo)" />
      <circle cx="25.5" cy="21.5" r="3.2" fill="var(--color-athena)" />
      <circle cx="6.5" cy="21.5" r="3.2" fill="var(--color-hermes)" />
      <circle cx="16" cy="16" r="2.4" fill="currentColor" />
    </svg>
  )
}
