// Activity feed: every event the backend sent, tagged with the agent that
// produced it and the time since the run started. Nothing here is simulated.
// Warnings and failures are amber; their raw messages stay folded away.

import type { ReactNode } from 'react'
import { ACTORS, actorOf } from '../agents'
import type { RunEvent } from '../api'

const STOP_REASONS: Record<string, string> = {
  hermes_complete: 'Hermes judged the sources sufficient',
  max_rounds_reached: 'the maximum number of rounds was reached',
  timeout: 'the time limit was reached',
  no_follow_up_queries: 'there were no new follow-up queries',
  gaps_skipped_by_user: 'you skipped the follow-up queries',
  plan_rejected_by_user: 'you rejected the plan',
  error: 'an error stopped the run',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-1.5 space-y-1 text-[13px] leading-snug text-slate-600">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
          <span className="min-w-0 break-words">{x}</span>
        </li>
      ))}
    </ul>
  )
}

function body(e: RunEvent): { title: ReactNode; extra?: ReactNode } {
  switch (e.type) {
    case 'plan':
      if (e.data.pending) return { title: 'Plan ready, waiting for your approval' }
      if (e.data.approved) return { title: `Plan approved: ${plural(e.data.plan.length, 'sub-question')}` }
      return { title: `Drafted a plan of ${plural(e.data.plan.length, 'sub-question')}`, extra: <List items={e.data.plan} /> }
    case 'search_started':
      return { title: `Searching ${plural(e.data.queries.length, 'query', 'queries')}`, extra: <List items={e.data.queries} /> }
    case 'search_done':
      return {
        title: <span className="text-slate-800">“{e.data.query}”</span>,
        extra: (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-athena">{e.data.new_sources} new source{e.data.new_sources === 1 ? '' : 's'}</span>
            {[...new Set(e.data.sources.map((s) => host(s.url)))].map((h) => (
              <span key={h} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{h}</span>
            ))}
          </div>
        ),
      }
    case 'search_failed':
      return { title: `No results for “${e.data.query}”`, extra: <Folded items={[e.data.reason]} /> }
    case 'review': {
      const d = e.data
      if (d.stop_reason) return { title: `Stopping: ${STOP_REASONS[d.stop_reason] ?? d.stop_reason}` }
      if (d.gaps_decision) return { title: `Follow-up queries ${d.gaps_decision}`, extra: d.gaps ? <List items={d.gaps} /> : undefined }
      if (d.complete) return { title: 'The sources cover every sub-question' }
      const n = d.gaps?.length ?? 0
      return {
        title: n ? `Found ${n} gap${n === 1 ? '' : 's'}, asking for another round` : 'Found no further gaps',
        extra: (
          <>
            {n > 0 && <List items={d.gaps ?? []} />}
            {!!d.contradictions && <p className="mt-1.5 text-xs font-medium text-hermes">{d.contradictions} conflict(s) between sources</p>}
          </>
        ),
      }
    }
    case 'gaps_pending':
      return { title: 'Follow-up queries ready, waiting for your approval' }
    case 'section_written':
      return {
        title: `Section ${e.data.index + 1} written`,
        extra: (
          <p className="mt-0.5 text-xs text-slate-500">
            {e.data.citations ? `${e.data.citations} citation${e.data.citations === 1 ? '' : 's'}` : 'not found in sources'}
          </p>
        ),
      }
    case 'verification': {
      const c = e.data.counts
      const parts = [
        { n: c.verified, label: 'verified', bar: 'bg-emerald-500' },
        { n: c.partial, label: 'partial', bar: 'bg-amber-400' },
        { n: c.not_found, label: 'not found', bar: 'bg-red-400' },
        { n: c.unchecked, label: 'unchecked', bar: 'bg-slate-300' },
      ]
      return {
        title: `Checked ${e.data.total} cited claim${e.data.total === 1 ? '' : 's'}`,
        extra: e.data.total ? (
          <div className="mt-2">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
              {parts.map((p) => p.n > 0 && <span key={p.label} className={p.bar} style={{ width: `${(p.n / e.data.total) * 100}%` }} />)}
            </div>
            <p className="mt-1.5 text-xs tabular-nums text-slate-500">
              {parts.filter((p) => p.n).map((p) => `${p.n} ${p.label}`).join(' · ')}
            </p>
          </div>
        ) : undefined,
      }
    }
    case 'contradictions':
      return { title: e.data.count ? `${e.data.count} conflict(s) between sources` : 'No conflicts between sources' }
    case 'report_ready':
      return { title: 'Report ready' }
    case 'error':
      return {
        title: e.data.fatal ? 'The run stopped with an error' : `${e.data.count} warning${e.data.count === 1 ? '' : 's'} while ${NODE_VERB[e.data.node] ?? e.data.node}`,
        extra: <Folded items={e.data.messages} />,
      }
    case 'complete':
      return { title: e.data.status === 'complete' ? 'Run complete' : `Run ended: ${e.data.status}` }
  }
}

const NODE_VERB: Record<string, string> = {
  apollo_plan: 'planning',
  athena_search: 'searching',
  hermes_review: 'reviewing',
  assemble: 'writing',
  verify_claims: 'verifying',
  human: 'waiting for you',
  run: 'running',
}

function Folded({ items }: { items: string[] }) {
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer select-none text-amber-800 hover:underline">Show details</summary>
      <ul className="mt-1.5 space-y-1 break-words text-amber-900/80">{items.map((m, i) => <li key={i}>{m}</li>)}</ul>
    </details>
  )
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function ProgressFeed({ events }: { events: RunEvent[] }) {
  if (events.length === 0) return null
  const t0 = Date.parse(events[0].ts)
  const shown = events.filter((e) => e.type !== 'report_ready')

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel" aria-label="Activity">
      <h2 className="mb-4 text-base font-semibold">Activity</h2>
      <ol className="relative">
        {shown.map((e, i) => {
          const actor = ACTORS[actorOf(e)]
          const { title, extra } = body(e)
          const warn = e.type === 'error' || e.type === 'search_failed'
          const roundStart = e.type === 'search_started'
          return (
            <li key={i} className="feed-in">
              {roundStart && (
                <div className="mb-3 mt-1 flex items-center gap-3 text-xs font-semibold text-slate-500">
                  <span>Round {e.data.round}</span>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
              )}
              <div className={`relative flex gap-3 pb-4 ${warn ? '-mx-2 mb-3 rounded-xl bg-amber-50 px-2 pb-2 pt-2 ring-1 ring-amber-200' : ''}`}>
                <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${actor.soft} ${actor.text}`}>
                  <actor.Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xs font-semibold ${actor.text}`}>{actor.name}</span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-400">{clock(Date.parse(e.ts) - t0)}</span>
                  </div>
                  <p className={`text-sm leading-snug ${warn ? 'font-medium text-amber-900' : 'text-slate-800'}`}>{title}</p>
                  {extra}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
