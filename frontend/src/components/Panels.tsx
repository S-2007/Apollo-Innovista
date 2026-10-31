// Panels: SourcesTable (id, title, section, URL), VerificationTable (claim, status badge,
// evidence, status filter), ConflictsView (pyvis map in an iframe, or a no-conflicts message).

import { useState } from 'react'
import type { Claim, ClaimStatus, Source } from '../api'

const BADGE: Record<ClaimStatus, string> = {
  verified: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  partial: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  not_found: 'border-red-400/40 bg-red-400/10 text-red-300',
  unchecked: 'border-white/15 bg-white/5 text-zinc-300',
}

export function SourcesTable({ sources }: { sources: Source[] }) {
  if (!sources.length) return <p className="py-6 text-sm text-zinc-400">No sources were collected.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] table-fixed text-left text-sm [&_td]:[overflow-wrap:anywhere]">
        <thead className="font-mono text-[11px] uppercase text-zinc-400">
          <tr className="border-b border-white/10">
            <th className="w-12 py-2 pr-2 font-medium">ID</th>
            <th className="py-2 pr-3 font-medium">Title</th>
            <th className="w-16 py-2 pr-2 font-medium">Section</th>
            <th className="w-[38%] py-2 font-medium">URL</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className="border-b border-white/5 align-top">
              <td className="py-2.5 pr-2 font-mono text-xs text-accent">{s.id}</td>
              <td className="py-2.5 pr-3 text-zinc-200">{s.title || '(untitled)'}</td>
              <td className="py-2.5 pr-2 font-mono text-xs text-zinc-300">{s.section ?? '-'}</td>
              <td className="py-2.5 font-mono text-xs">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-zinc-300 underline decoration-white/20 underline-offset-2 hover:text-accent">
                  {s.url}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const FILTERS = ['all', 'verified', 'partial', 'not_found'] as const
type Filter = (typeof FILTERS)[number]

export function VerificationTable({ claims }: { claims: Claim[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = filter === 'all' ? claims : claims.filter((c) => c.status === filter)
  const count = (f: Filter) => (f === 'all' ? claims.length : claims.filter((c) => c.status === f).length)

  return (
    <div>
      <div role="group" aria-label="Filter claims by status" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
              filter === f ? 'border-accent bg-accent/15 text-accent' : 'border-white/15 text-zinc-300 hover:border-white/30'
            }`}
          >
            {f.replace('_', ' ')} · {count(f)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-sm text-zinc-400">No claims with this status.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {shown.map((c, i) => (
            <li key={`${filter}-${i}`} className="grid gap-x-4 gap-y-2 py-3 md:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1fr)]">
              <p className="text-sm text-zinc-200">{c.claim}</p>
              <div>
                <span
                  className={`stagger-in inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] ${BADGE[c.status] ?? BADGE.unchecked}`}
                  style={{ ['--i' as string]: Math.min(i, 10) }} // cap the stagger so long lists still appear quickly
                >
                  {c.status.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-zinc-400">{c.evidence ? `“${c.evidence}”` : 'No matching text in the retrieved source.'}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ConflictsView({ path }: { path: string | null }) {
  if (!path) return <p className="py-6 text-sm text-zinc-300">No conflicts found in sources.</p>
  return <iframe title="Contradiction map" src={path} className="h-[560px] w-full rounded-md border border-white/10 bg-white" />
}
