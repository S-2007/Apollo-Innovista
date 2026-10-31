// Agent Orchestration: the LangGraph pipeline with each step's live state, what every
// graph node cost (calls, time, tokens) from the usage meter, and the run's event feed.

import AgentStrip from '../components/AgentStrip'
import ProgressFeed from '../components/ProgressFeed'
import type { AnyEvent } from '../api'
import { useStore } from '../store'
import { Card, Empty, Meter, fmtInt, fmtSec } from '../ui'

const STEPS = [
  { key: 'plan', agent: 'APOLLO', label: 'Plan sub-questions', on: ['plan'] },
  { key: 'approve', agent: 'HUMAN', label: 'Approve plan', on: ['plan:await'] },
  { key: 'search', agent: 'ATHENA', label: 'Search & extract', on: ['search_started', 'search_done', 'search_failed'] },
  { key: 'review', agent: 'HERMES', label: 'Review coverage', on: ['review'] },
  { key: 'gaps', agent: 'HUMAN', label: 'Approve gap queries', on: ['gaps_pending'] },
  { key: 'write', agent: 'APOLLO', label: 'Write cited sections', on: ['section_written'] },
  { key: 'verify', agent: 'VERIFIER', label: 'Verify claims', on: ['verification'] },
  { key: 'report', agent: 'APOLLO', label: 'Contradictions & report', on: ['contradictions', 'report_ready'] },
] as const

type StepState = 'idle' | 'active' | 'done' | 'skipped'

function stepStates(events: AnyEvent[], finished: boolean, failed: boolean): StepState[] {
  const seen = new Set<number>()
  let last = -1
  for (const e of events) {
    const tag = e.type === 'plan' && (e.data as { awaiting_approval?: boolean }).awaiting_approval ? 'plan:await' : e.type
    const i = STEPS.findIndex((s) => (s.on as readonly string[]).includes(tag))
    if (i >= 0) {
      seen.add(i)
      last = i
    }
  }
  return STEPS.map((_, i) => {
    if (seen.has(i)) return i === last && !finished ? 'active' : 'done'
    if (i < last || (finished && !failed)) return 'skipped' // e.g. no human approval in auto mode
    return 'idle'
  })
}

const NODE_AGENT: Record<string, string> = {
  apollo_plan: 'Apollo', review_plan: 'Human gate', athena_search: 'Athena', hermes_review: 'Hermes',
  review_gaps: 'Human gate', decide: 'Loop control', write_section: 'Apollo', assemble: 'Apollo', verify_claims: 'Verifier',
}

const RING: Record<StepState, string> = {
  idle: 'border-white/10 text-zinc-500',
  active: 'pulse-border border-accent/70 text-accent',
  done: 'border-emerald-400/40 text-emerald-300',
  skipped: 'border-dashed border-white/10 text-zinc-500',
}

export default function Agents() {
  const { d, maxRounds, events, metrics, runId } = useStore()
  const states = stepStates(events, d.finished, d.status === 'failed')
  const rows = metrics?.by_node ?? []
  const maxSec = Math.max(0, ...rows.map((r) => r.seconds))

  return (
    <div className="space-y-5">
      <AgentStrip d={d} maxRounds={maxRounds} />

      <Card title="Pipeline" aside="LangGraph StateGraph · loop limits enforced in code">
        {!runId ? (
          <Empty>Start a run to see the pipeline move.</Empty>
        ) : (
          <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.key} className={`rounded-md border bg-black/20 px-3 py-2.5 ${RING[states[i] ?? 'idle']}`}>
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wide">
                  <span>{String(i + 1).padStart(2, '0')} · {s.agent}</span>
                  <span>{states[i]}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-200">{s.label}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          Search → review repeats for at most {maxRounds} round{maxRounds === 1 ? '' : 's'}; the loop also stops on the wall-clock timeout or when Hermes finds no gaps.
        </p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Work per graph node" aside="from the usage meter">
          {!rows.length ? (
            <Empty>No metered calls for this run{runId ? ' yet' : ''}.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="font-mono text-[11px] uppercase text-zinc-400">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3 font-medium">Node</th>
                    <th className="py-2 pr-3 font-medium">Agent</th>
                    <th className="py-2 pr-3 font-medium">Calls</th>
                    <th className="w-36 py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className="border-b border-white/5">
                      <td className="py-2 pr-3 font-mono text-xs text-zinc-200">{r.name}</td>
                      <td className="py-2 pr-3 text-xs text-zinc-400">{NODE_AGENT[r.name] ?? '–'}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.calls}{r.failed ? <span className="text-amber-300"> · {r.failed}✕</span> : ''}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2"><span className="w-12 font-mono text-xs">{fmtSec(r.seconds)}</span><div className="flex-1"><Meter value={r.seconds} max={maxSec} /></div></div>
                      </td>
                      <td className="py-2 font-mono text-xs">{fmtInt(r.prompt_tokens + r.completion_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="min-w-0">
          <ProgressFeed events={events} />
        </div>
      </div>
    </div>
  )
}
