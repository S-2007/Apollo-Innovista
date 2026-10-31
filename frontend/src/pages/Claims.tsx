// Claims & Evidence: every checked claim with its status, the source sentence that
// supports it, and links to the cited sources. Filter by status, search by text.

import { useState } from 'react'
import { useStore } from '../store'
import { Card, Empty, NeedsRun, Pill, hostOf } from '../ui'

const FILTERS = ['all', 'verified', 'partial', 'not_found', 'unchecked'] as const
type Filter = (typeof FILTERS)[number]

export default function Claims() {
  const { report, busy } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  if (!report) return <NeedsRun what="Claims and evidence" busy={busy} />

  const claims = report.verification ?? []
  const byId = new Map(report.sources.map((s) => [s.id, s]))
  const count = (f: Filter) => (f === 'all' ? claims.length : claims.filter((c) => c.status === f).length)
  const needle = q.trim().toLowerCase()
  const shown = claims.filter((c) => (filter === 'all' || c.status === filter) && (!needle || c.claim.toLowerCase().includes(needle) || (c.evidence ?? '').toLowerCase().includes(needle)))

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter claims by status" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${filter === f ? 'border-accent bg-accent/15 text-accent' : 'border-white/15 text-zinc-300 hover:border-white/30'}`}
            >
              {f.replace('_', ' ')} · {count(f)}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search claims or evidence"
          aria-label="Search claims or evidence"
          className="ml-auto w-full rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-accent/70 focus:outline-none sm:w-64"
        />
      </div>
      {!shown.length ? (
        <Empty>No claims match.</Empty>
      ) : (
        <ul className="space-y-3">
          {shown.map((c, i) => (
            <li key={`${i}-${c.claim.slice(0, 20)}`} className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="flex items-start gap-3">
                <p className="min-w-0 flex-1 text-sm text-zinc-100">{c.claim}</p>
                <Pill status={c.status} />
              </div>
              <blockquote className="mt-2 border-l-2 border-white/15 pl-3 text-xs leading-relaxed text-zinc-400">
                {c.evidence ? `“${c.evidence}”` : c.status === 'unchecked' ? 'Not checked: the verifier was unavailable or the claim cap was reached.' : 'No matching text in the retrieved source.'}
              </blockquote>
              {(c.source_ids ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(c.source_ids ?? []).map((id) => {
                    const s = byId.get(id)
                    return s ? (
                      <a key={id} href={s.url} target="_blank" rel="noreferrer" title={s.title} className="rounded border border-accent/30 bg-accent/5 px-1.5 py-0.5 font-mono text-[11px] text-accent hover:bg-accent hover:text-void">
                        {id} · {hostOf(s.url)}
                      </a>
                    ) : (
                      <span key={id} className="rounded border border-red-400/40 px-1.5 py-0.5 font-mono text-[11px] text-red-300">{id} · unknown source</span>
                    )
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
