// Vertical timeline of the run's events. Every line is built from an event the
// backend sent; nothing here is simulated. Warnings and failures are amber.

import type { RunEvent } from '../api'

type Kind = 'plan' | 'search' | 'review' | 'gap' | 'warning' | 'done'

const ICON: Record<Kind, { symbol: string; style: string }> = {
  plan: { symbol: '◆', style: 'bg-indigo-100 text-indigo-700' },
  search: { symbol: '⌕', style: 'bg-zinc-100 text-zinc-700' },
  review: { symbol: '✓', style: 'bg-zinc-100 text-zinc-700' },
  gap: { symbol: '?', style: 'bg-indigo-100 text-indigo-700' },
  warning: { symbol: '!', style: 'bg-amber-100 text-amber-800' },
  done: { symbol: '■', style: 'bg-indigo-600 text-white' },
}

const STOP_REASONS: Record<string, string> = {
  hermes_complete: 'Hermes judged the sources sufficient',
  max_rounds_reached: 'maximum number of rounds reached',
  timeout: 'time limit reached',
  no_follow_up_queries: 'no new follow-up queries',
  gaps_skipped_by_user: 'you skipped the gap queries',
}

function describe(e: RunEvent): { kind: Kind; title: string; detail?: string[]; amber?: boolean } {
  switch (e.type) {
    case 'plan':
      if (e.data.pending) return { kind: 'plan', title: 'Plan ready: waiting for your approval', detail: e.data.plan }
      if (e.data.approved) return { kind: 'plan', title: `Plan approved: ${e.data.plan.length} sub-questions`, detail: e.data.plan }
      return { kind: 'plan', title: `Apollo proposed ${e.data.plan.length} sub-questions` }
    case 'search_started':
      return { kind: 'search', title: `Round ${e.data.round}: Athena searches ${e.data.queries.length} queries`, detail: e.data.queries }
    case 'search_done':
      return { kind: 'search', title: `“${e.data.query}”`, detail: [`${e.data.new_sources} new sources`] }
    case 'search_failed':
      return { kind: 'warning', amber: true, title: `No results for “${e.data.query}”`, detail: [e.data.reason] }
    case 'review': {
      const d = e.data
      if (d.stop_reason) return { kind: 'review', title: `Apollo stops: ${STOP_REASONS[d.stop_reason] ?? d.stop_reason}` }
      if (d.gaps_decision) return { kind: 'gap', title: `Gap queries ${d.gaps_decision}`, detail: d.gaps ?? undefined }
      if (d.complete) return { kind: 'review', title: `Hermes: sources cover the plan (round ${d.round})` }
      return {
        kind: 'gap',
        title: `Hermes found ${d.gaps?.length ?? 0} gap(s) in round ${d.round}`,
        detail: [...(d.gaps ?? []), ...(d.contradictions ? [`${d.contradictions} conflict(s) between sources`] : [])],
      }
    }
    case 'gaps_pending':
      return { kind: 'gap', title: 'Follow-up queries: waiting for your approval', detail: e.data.gaps }
    case 'section_written':
      return {
        kind: 'review',
        title: `Section ${e.data.index + 1} written`,
        detail: [e.data.not_found && e.data.citations === 0 ? 'not found in sources' : `${e.data.citations} citation(s)`],
      }
    case 'verification': {
      const c = e.data.counts
      return { kind: 'review', title: `Verified ${e.data.total} claims`, detail: [`${c.verified} verified · ${c.partial} partial · ${c.not_found} not found · ${c.unchecked} unchecked`] }
    }
    case 'contradictions':
      return { kind: 'review', title: e.data.count ? `${e.data.count} conflict(s) between sources` : 'No conflicts found in sources' }
    case 'report_ready':
      return { kind: 'done', title: 'Report ready' }
    case 'error':
      return {
        kind: 'warning',
        amber: true,
        title: e.data.fatal ? 'The run stopped with an error' : `${e.data.count} warning(s) from ${e.data.node}`,
        detail: e.data.messages,
      }
    case 'complete':
      return { kind: 'done', title: `Finished: ${e.data.status}` }
  }
}

export default function ProgressFeed({ events }: { events: RunEvent[] }) {
  if (events.length === 0) return null
  return (
    <ol className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
      {events.map((e, i) => {
        const d = describe(e)
        const icon = ICON[d.kind]
        const long = e.type === 'error' // warning messages can be long; plans and queries stay visible
        return (
          <li key={i} className={`flex gap-3 text-sm ${d.amber ? 'rounded-md bg-amber-50 p-2 text-amber-900' : ''}`}>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${icon.style}`}>
              {icon.symbol}
            </span>
            <div className="min-w-0">
              <p className="font-medium">{d.title}</p>
              {d.detail && d.detail.length > 0 &&
                (long ? (
                  <details className="text-xs text-zinc-600">
                    <summary className="cursor-pointer">details</summary>
                    <ul className="ml-4 list-disc break-words">{d.detail.map((x, j) => <li key={j}>{x}</li>)}</ul>
                  </details>
                ) : (
                  <ul className="ml-4 list-disc break-words text-xs text-zinc-600">{d.detail.map((x, j) => <li key={j}>{x}</li>)}</ul>
                ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
