// Research Planning: how Apollo understood the question (its sub-questions), the human
// approval gate (approve / edit / reject through the existing resume API), execution
// controls, task tracking per sub-question and follow-up query, and the run configuration.
// Settings the backend does not accept per run are shown as unavailable.

import { useState } from 'react'
import HitlPanel from '../components/HitlPanel'
import { isKnown } from '../api'
import { useStore } from '../store'
import { Confirm, Empty, Meter, PageHeader, Panel, Pill, Unavailable, btn } from '../ui'

export default function Planning() {
  const { d, events, report, showHitl, answer, runId, selected, busy, system } = useStore()
  const [confirmStop, setConfirmStop] = useState(false)
  const plan = report?.plan?.length ? report.plan : d.subQuestions

  // Search outcome per query and the follow-up queries per round, from the event log.
  const outcome = new Map<string, 'done' | 'failed'>()
  const rounds: { round: number; complete: boolean; gaps: string[] }[] = []
  for (const e of events) {
    if (!isKnown(e)) continue
    if (e.type === 'search_done' && e.data.query) outcome.set(e.data.query, 'done')
    if (e.type === 'search_failed' && e.data.query) outcome.set(e.data.query, 'failed')
    if (e.type === 'review') rounds.push({ round: e.data.round ?? rounds.length + 1, complete: !!e.data.complete, gaps: e.data.gaps ?? [] })
  }
  const sourcesFor = (i: number) => (report?.sources ?? []).filter((s) => s.section === i + 1)
  const sectionFor = (i: number) => report?.sections?.find((s) => s.index === i + 1)
  const tasks = plan.length + rounds.reduce((a, r) => a + r.gaps.length, 0)
  const tasksDone = [...outcome.keys()].length

  if (!runId) {
    return (
      <div>
        <PageHeader kicker="05 · Research planning" title="Plan, approve, track" />
        <Panel><Empty>Start a run (with Human approval on, to edit the plan before it executes).</Empty></Panel>
      </div>
    )
  }

  return (
    <div>
      <PageHeader kicker="05 · Research planning" title="Plan, approve, track">
        <Pill status={selected?.status ?? 'idle'} />
      </PageHeader>

      {showHitl && (
        <div className="mb-5">
          {d.planPending
            ? <HitlPanel key={d.pendingAt} mode="plan" items={d.subQuestions} onAnswer={answer} />
            : <HitlPanel key={d.pendingAt} mode="gaps" items={d.gapsPending ?? []} onAnswer={answer} />}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Panel label="Question understanding" title={selected?.topic ?? 'Research question'} aside={d.planPending ? 'awaiting your approval' : `${plan.length} sub-questions`}>
            {!plan.length ? <Empty>Apollo is decomposing the question…</Empty> : (
              <ol className="divide-y divide-hair">
                {plan.map((q, i) => {
                  const src = sourcesFor(i)
                  const sec = sectionFor(i)
                  const state = outcome.get(q)
                  return (
                    <li key={i} className="grid gap-2 py-3 md:grid-cols-[2.25rem_minmax(0,1fr)_auto] md:items-start">
                      <span className="font-mono text-xs text-accent-ink">Q{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm text-ink">{q}</p>
                        {src.length > 0 && <p className="mt-1 font-mono text-[11px] text-muted">{src.length} source{src.length === 1 ? '' : 's'}: {src.map((s) => s.id).join(' ')}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {state ? <Pill status={state === 'done' ? 'done' : 'failed'} label={state === 'done' ? 'searched' : 'search failed'} /> : <Pill status="idle" label="queued" />}
                        {sec && <Pill status={sec.not_found ? 'not_found' : 'verified'} label={sec.not_found ? 'not found in sources' : `${sec.citations} cited`} />}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            <div className="mt-4">
              <Unavailable what="False-premise detection" need="a check that the question's assumptions are true before planning; the planner decomposes the question as asked." />
            </div>
          </Panel>

          <Panel label="Task management" title="Follow-up queries by round" aside="ordered by Hermes after each search round">
            {!rounds.length ? <Empty>No review yet.</Empty> : (
              <ul className="space-y-4">
                {rounds.map((r) => (
                  <li key={r.round}>
                    <p className="label">Round {r.round} · {r.complete ? 'sources cover the plan' : r.gaps.length ? `${r.gaps.length} follow-up quer${r.gaps.length === 1 ? 'y' : 'ies'}` : 'no usable verdict'}</p>
                    {r.gaps.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {r.gaps.map((g) => (
                          <li key={g} className="flex items-start justify-between gap-3 border border-line px-3 py-2 text-sm text-ink">
                            <span className="min-w-0">{g}</span>
                            {outcome.get(g) ? <Pill status={outcome.get(g) === 'done' ? 'done' : 'failed'} label={outcome.get(g) === 'done' ? 'searched' : 'failed'} /> : <Pill status="idle" label="not run" />}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel label="Progress" title="Execution">
            <div className="flex items-center gap-2"><Meter value={tasksDone} max={Math.max(1, tasks)} /><span className="font-mono text-xs">{tasksDone}/{tasks}</span></div>
            <p className="mt-1 text-[11px] text-muted">Searches finished out of planned + follow-up queries.</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button className={btn.secondary} disabled title="The backend has no pause endpoint">Pause</button>
              <button className={btn.secondary} disabled={!showHitl} onClick={() => answer('approve')} title={showHitl ? 'Approve and continue' : 'Resume is available while the run waits for your approval'}>Resume</button>
              <button className={btn.danger} disabled={!(showHitl && d.planPending)} onClick={() => setConfirmStop(true)}>Terminate</button>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Resume answers a pending approval. Terminate is possible only at the plan-approval step (it rejects the plan); the backend has no pause or mid-run cancel. Every run still ends on its own: max {system?.limits.max_rounds ?? 2} rounds, {system?.limits.timeout_seconds ?? 180}s research timeout.
            </p>
            {busy && !showHitl && <p className="mt-2 font-mono text-xs text-accent-ink" role="status">Running…</p>}
          </Panel>

          <Panel label="Run configuration" title="Settings for this run">
            <dl className="divide-y divide-hair text-sm">
              <Row k="Research depth" v={`${selected?.max_rounds ?? '–'} round${selected?.max_rounds === 1 ? '' : 's'}`} />
              <Row k="Human approval" v={selected?.hitl ? 'on' : 'off'} />
              <Row k="Agents" v="Apollo · Athena · Hermes" />
              <Row k="Search" v="Tavily, Serper fallback" />
              <Row k="Verifier chain" v={system?.llm.verify_chain.join(' → ') ?? '–'} />
            </dl>
            <div className="mt-3 space-y-2">
              <Unavailable what="Source & agent selection, research priority" need="per-run fields in POST /api/runs (it accepts topic, max_rounds, hitl)." />
              <Unavailable what="Verification strictness" need="a per-run threshold; the verifier uses the fixed VERIFY_PARTIAL_SIM in config.py." />
            </div>
          </Panel>
        </div>
      </div>

      <Confirm
        open={confirmStop}
        title="Terminate this run?"
        body="This rejects the plan. The run ends without searching or writing a report, and cannot be resumed."
        confirmLabel="Terminate run"
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false)
          void answer('reject')
        }}
      />
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-start justify-between gap-4 py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-mono text-xs text-ink [overflow-wrap:anywhere]">{v}</dd></div>
}
