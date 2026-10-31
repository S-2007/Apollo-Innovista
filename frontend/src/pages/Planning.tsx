// Research Planning: Apollo's sub-questions with the search outcome and sources per
// sub-question, the follow-up (gap) queries Hermes proposed each round, and any
// pending approval.

import HitlPanel from '../components/HitlPanel'
import { isKnown } from '../api'
import { useStore } from '../store'
import { Card, Empty, Pill } from '../ui'

export default function Planning() {
  const { d, events, report, showHitl, answer, runId } = useStore()
  const plan = report?.plan?.length ? report.plan : d.subQuestions

  // Search outcome per query, and the gap queries per round, straight from the event log.
  const outcome = new Map<string, 'done' | 'failed'>()
  const rounds: { round: number; complete: boolean; gaps: string[] }[] = []
  for (const e of events) {
    if (!isKnown(e)) continue
    if (e.type === 'search_done' && e.data.query) outcome.set(e.data.query, 'done')
    if (e.type === 'search_failed' && e.data.query) outcome.set(e.data.query, 'failed')
    if (e.type === 'review') rounds.push({ round: e.data.round ?? rounds.length + 1, complete: !!e.data.complete, gaps: e.data.gaps ?? [] })
  }
  const gapQueries = rounds.flatMap((r) => r.gaps)
  const sourcesFor = (i: number) => (report?.sources ?? []).filter((s) => s.section === i + 1)
  const sectionFor = (i: number) => report?.sections?.find((s) => s.index === i + 1)

  if (!runId) return <Card><Empty>Start a run to see its research plan.</Empty></Card>

  return (
    <div className="space-y-5">
      {showHitl && (
        d.planPending
          ? <HitlPanel key={d.pendingAt} mode="plan" items={d.subQuestions} onAnswer={answer} />
          : <HitlPanel key={d.pendingAt} mode="gaps" items={d.gapsPending ?? []} onAnswer={answer} />
      )}

      <Card title="Sub-questions" aside={d.planPending ? 'awaiting your approval' : `${plan.length} planned`}>
        {!plan.length ? (
          <Empty>Apollo is planning…</Empty>
        ) : (
          <ol className="divide-y divide-white/5">
            {plan.map((q, i) => {
              const src = sourcesFor(i)
              const sec = sectionFor(i)
              const state = outcome.get(q)
              return (
                <li key={i} className="grid gap-2 py-3 md:grid-cols-[2rem_minmax(0,1fr)_auto] md:items-start">
                  <span className="font-mono text-xs text-accent">Q{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">{q}</p>
                    {src.length > 0 && (
                      <p className="mt-1 text-xs text-zinc-400">
                        {src.length} source{src.length === 1 ? '' : 's'}: <span className="font-mono">{src.map((s) => s.id).join(' ')}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {state && <Pill status={state === 'done' ? 'complete' : 'failed'} label={state === 'done' ? 'searched' : 'search failed'} />}
                    {sec && <Pill status={sec.not_found ? 'not_found' : 'verified'} label={sec.not_found ? 'not found in sources' : `${sec.citations} citations`} />}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </Card>

      <Card title="Follow-up queries by round" aside="Hermes' review after each search round">
        {!rounds.length ? (
          <Empty>No review yet.</Empty>
        ) : (
          <ul className="space-y-4">
            {rounds.map((r) => (
              <li key={r.round}>
                <p className="font-mono text-xs uppercase text-zinc-400">
                  Round {r.round} · {r.complete ? 'sources cover the plan' : r.gaps.length ? `${r.gaps.length} gap quer${r.gaps.length === 1 ? 'y' : 'ies'}` : 'no usable verdict'}
                </p>
                {r.gaps.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {r.gaps.map((g) => (
                      <li key={g} className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">
                        <span className="min-w-0">{g}</span>
                        {outcome.get(g) ? <Pill status={outcome.get(g) === 'done' ? 'complete' : 'failed'} label={outcome.get(g) === 'done' ? 'searched' : 'failed'} /> : <Pill status="unchecked" label="not run" />}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        {gapQueries.length > 0 && <p className="mt-3 text-xs text-zinc-500">"Not run" means the round limit, the timeout, or your decision ended the loop before this query.</p>}
      </Card>
    </div>
  )
}
