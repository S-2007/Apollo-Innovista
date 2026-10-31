// One row per cited claim: the claim, its status badge, and the best-matching
// sentence from the retrieved source text. Filterable by status.
// The verifier does not record WHICH cited source held the best match, so with
// several citations the label says "among S1, S2" rather than guessing.

import { useState } from 'react'
import type { Claim, ClaimStatus } from '../api'
import { BADGE } from './SourcesTable'

const STATUSES: ClaimStatus[] = ['verified', 'partial', 'not_found', 'unchecked']

export default function VerificationTable({ claims }: { claims: Claim[] }) {
  const [filter, setFilter] = useState<ClaimStatus | 'all'>('all')
  const shown = filter === 'all' ? claims : claims.filter((c) => c.status === filter)

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {(['all', ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-md border px-2 py-1 ${filter === s ? 'border-indigo-600 bg-indigo-50 text-indigo-800' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`}
          >
            {s.replace('_', ' ')} ({s === 'all' ? claims.length : claims.filter((c) => c.status === s).length})
          </button>
        ))}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
          <tr>
            <th className="py-2 pr-3">Claim</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2">Evidence (retrieved source text)</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c, i) => (
            <tr key={i} className="border-b border-zinc-100 align-top">
              <td className="py-2 pr-3">{c.claim}</td>
              <td className="py-2 pr-3">
                <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${BADGE[c.status]}`}>{c.status.replace('_', ' ')}</span>
              </td>
              <td className="py-2 text-xs text-zinc-600">
                {c.best_match ? (
                  <>
                    <span className="text-zinc-400">
                      Best match {c.source_ids.length > 1 ? `among ${c.source_ids.join(', ')}` : `in ${c.source_ids[0]}`}:{' '}
                    </span>
                    “{c.best_match}”
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="py-4 text-sm text-zinc-500">No claims with this status.</p>}
    </div>
  )
}
