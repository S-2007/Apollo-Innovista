// One entry per cited claim: the claim, its status, and the best-matching
// sentence from the retrieved source text. Filterable by status.
// The verifier does not record WHICH cited source held the best match, so with
// several citations the label says "among S1, S2" rather than guessing.

import { CircleCheck, CircleDashed, CircleHelp, CircleX, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { Claim, ClaimStatus } from '../api'
import { BADGE } from './SourcesTable'

const STATUSES: ClaimStatus[] = ['verified', 'partial', 'not_found', 'unchecked']
const ICON: Record<ClaimStatus, LucideIcon> = {
  verified: CircleCheck,
  partial: CircleHelp,
  not_found: CircleX,
  unchecked: CircleDashed,
}

export default function VerificationTable({ claims }: { claims: Claim[] }) {
  const [filter, setFilter] = useState<ClaimStatus | 'all'>('all')
  const shown = filter === 'all' ? claims : claims.filter((c) => c.status === filter)

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Each cited sentence was compared with the retrieved text of the source it cites. Verified means the source states it;
        partial means the source discusses it but does not fully back it.
      </p>
      <div className="mb-5 flex flex-wrap gap-2 text-xs" role="group" aria-label="Filter by status">
        {(['all', ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={`rounded-full px-3 py-1.5 font-medium tabular-nums ring-1 transition-colors ${
              filter === s ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {s.replace('_', ' ')} · {s === 'all' ? claims.length : claims.filter((c) => c.status === s).length}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-slate-100">
        {shown.map((c, i) => {
          const Icon = ICON[c.status]
          return (
            <li key={i} className="grid gap-x-6 gap-y-2 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ${BADGE[c.status]}`}>
                  <Icon className="h-3.5 w-3.5" /> {c.status.replace('_', ' ')}
                </span>
                <p className="mt-2 font-serif text-[15px] leading-relaxed text-slate-800">{c.claim}</p>
              </div>
              <div className="text-sm">
                {c.best_match ? (
                  <figure className="border-l-2 border-slate-200 pl-3">
                    <blockquote className="text-slate-600">“{c.best_match}”</blockquote>
                    <figcaption className="mt-1 font-mono text-[11px] text-slate-400">
                      best match {c.source_ids.length > 1 ? `among ${c.source_ids.join(', ')}` : `in ${c.source_ids[0]}`}
                    </figcaption>
                  </figure>
                ) : (
                  <p className="text-slate-400">No matching sentence in the retrieved text.</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {shown.length === 0 && <p className="py-6 text-sm text-slate-500">No claims with this status.</p>}
    </div>
  )
}
