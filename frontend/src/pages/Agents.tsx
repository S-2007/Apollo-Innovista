// Agent Orchestration: the APOLLO orchestrator and ten specialist roles. Each role is mapped to
// the real LangGraph node that performs it; its status comes from the event stream and its
// performance from the usage meter. Roles the backend does not implement are shown as
// "not implemented" with what they would need, never as working agents.

import { useState } from 'react'
import type { AnyEvent, Metrics } from '../api'
import type { Derived } from '../derive'
import ProgressFeed from '../components/ProgressFeed'
import { classifyErrors } from '../insights'
import { useStore } from '../store'
import { Empty, Meter, PageHeader, Panel, Pill, fmtInt, fmtSec } from '../ui'

type Status = 'idle' | 'working' | 'completed' | 'failed' | 'unavailable'

interface Agent {
  key: string
  name: string
  role: string
  backedBy: string | null // the graph node(s) / code doing this work, or null if not implemented
  nodes: string[]
  need?: string
}

const ORCHESTRATOR: Agent = {
  key: 'apollo', name: 'APOLLO', role: 'Orchestrator: decomposes the question, routes rounds, enforces loop limits',
  backedBy: 'apollo_plan · review_plan · decide (LangGraph conditional edges)', nodes: ['apollo_plan', 'review_plan', 'decide', 'review_gaps'],
}

const AGENTS: Agent[] = [
  { key: 'web', name: 'Web Discovery', role: 'Searches the web for each sub-question', backedBy: 'Athena · athena_search (Tavily → Serper)', nodes: ['athena_search'] },
  { key: 'academic', name: 'Academic Research', role: 'Searches scholarly indexes', backedBy: null, nodes: [], need: 'a scholarly search API (e.g. Semantic Scholar / OpenAlex) wired into Athena' },
  { key: 'fact', name: 'Fact Verification', role: 'Checks each claim against source sentences', backedBy: 'verify_claims (embeddings + LLM chain)', nodes: ['verify_claims'] },
  { key: 'cite', name: 'Citation Validation', role: 'Drops uncited sentences and citations to unknown sources', backedBy: 'enforce_citations in write_section / assemble', nodes: [] },
  { key: 'contra', name: 'Contradiction Detection', role: 'Finds sources that disagree', backedBy: 'Hermes · hermes_review', nodes: ['hermes_review'] },
  { key: 'extract', name: 'PDF & Document Extraction', role: 'Pulls main text from result pages', backedBy: 'Athena page extraction (trafilatura → Tavily raw); HTML only, no PDF/OCR', nodes: [] },
  { key: 'cred', name: 'Source Credibility', role: 'Scores authority and reliability', backedBy: null, nodes: [], need: 'a credibility model or rating source; the backend returns no score' },
  { key: 'recency', name: 'Recency Monitoring', role: 'Checks publication dates and freshness', backedBy: null, nodes: [], need: 'publication dates from search results or page metadata' },
  { key: 'sec', name: 'Security & Injection Detection', role: 'Flags instructions hidden in retrieved pages', backedBy: null, nodes: [], need: 'a prompt-injection scanner over extracted text' },
  { key: 'synth', name: 'Research Synthesis', role: 'Writes cited sections and the report', backedBy: 'Apollo · write_section (parallel per section) + assemble', nodes: ['write_section', 'assemble'] },
]

const MAP: Record<string, Status> = { idle: 'idle', active: 'working', done: 'completed', error: 'failed' }

function statuses(d: Derived, events: AnyEvent[]): Record<string, Status> {
  const seen = (t: string) => events.some((e) => e.type === t)
  const sections = events.filter((e) => e.type === 'section_written').length
  const writing = sections > 0 && !seen('verification')
  const failed = d.status === 'failed'
  const step = (done: boolean, working: boolean): Status => (done ? 'completed' : working ? (failed ? 'failed' : 'working') : 'idle')
  const athena = MAP[d.athena] ?? 'idle'
  return {
    apollo: d.status === 'complete' ? 'completed' : failed ? 'failed' : events.length ? 'working' : 'idle',
    web: athena,
    extract: athena,
    contra: MAP[d.hermes] ?? 'idle',
    synth: step(seen('report_ready'), writing || (sections === 0 && d.round > 0 && d.hermes === 'done' && !d.finished)),
    cite: step(seen('verification') || seen('report_ready'), writing),
    fact: step(seen('verification'), sections > 0 && sections >= d.subQuestions.length && !seen('verification')),
  }
}

function perf(a: Agent, m: Metrics | null) {
  const rows = (m?.by_node ?? []).filter((r) => a.nodes.includes(r.name))
  return { calls: rows.reduce((s, r) => s + r.calls, 0), failed: rows.reduce((s, r) => s + r.failed, 0), seconds: rows.reduce((s, r) => s + r.seconds, 0), tokens: rows.reduce((s, r) => s + r.prompt_tokens + r.completion_tokens, 0) }
}

function currentTask(key: string, d: Derived, events: AnyEvent[]): string {
  const last = [...events].reverse().find((e) => e.type === 'search_started') as { data?: { query?: string } } | undefined
  switch (key) {
    case 'apollo': return d.labels.apollo
    case 'web': case 'extract': return d.athena === 'active' ? `${d.labels.athena}: ${last?.data?.query ?? ''}` : d.labels.athena
    case 'contra': return d.labels.hermes
    case 'synth': return `${events.filter((e) => e.type === 'section_written').length}/${d.subQuestions.length || '?'} sections written`
    default: return ''
  }
}

const STATUS_TEXT: Record<Status, string> = { idle: 'Idle', working: 'Working', completed: 'Completed', failed: 'Failed', unavailable: 'Not implemented' }
const PILL_OF: Record<Status, string> = { idle: 'idle', working: 'working', completed: 'done', failed: 'failed', unavailable: 'unavailable' }

export default function Agents() {
  const { d, events, metrics, runId, report, maxRounds } = useStore()
  const st = statuses(d, events)
  const statusOf = (a: Agent): Status => (a.backedBy ? st[a.key] ?? 'idle' : 'unavailable')
  const [focus, setFocus] = useState<string | null>(null)
  const errs = classifyErrors(report?.errors)
  const sections = events.filter((e) => e.type === 'section_written').length
  const progress: Record<string, [number, number] | null> = {
    web: d.searchTotal ? [d.searchDone, d.searchTotal] : null,
    synth: d.subQuestions.length ? [sections, d.subQuestions.length] : null,
  }
  const outcome: Record<string, string> = report ? {
    web: `${report.sources.length} sources retrieved`,
    extract: `${report.sources.filter((s) => s.extracted_by !== 'snippet only').length}/${report.sources.length} pages read in full`,
    cite: `${(errs.uncited_dropped ?? []).length} uncited sentences removed · ${(errs.bad_citation ?? []).length} invalid citations removed`,
    fact: `${report.verification.filter((c) => c.status === 'verified').length}/${report.verification.length} claims verified`,
    contra: `${(report.contradictions ?? []).length} contradictions found`,
    synth: `${report.sections?.length ?? 0} sections · ${report.citation_check?.citations ?? 0} inline citations`,
  } : {}
  const working = AGENTS.filter((a) => statusOf(a) === 'working').length

  return (
    <div>
      <PageHeader kicker="04 · Agent orchestration" title="Multi-agent execution">
        <span className="font-mono text-xs text-muted">{AGENTS.filter((a) => a.backedBy).length} of {AGENTS.length} specialist roles implemented · {working} working</span>
      </PageHeader>

      {!runId && <div className="mb-5"><Panel><Empty>Start a research run to see the agents work. The network below shows how the roles map to the pipeline.</Empty></Panel></div>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Panel label="Agent network" title="APOLLO orchestrator and specialists" aside="hover or focus a node">
          <Network agents={AGENTS} statusOf={statusOf} apollo={st.apollo ?? 'idle'} focus={focus} setFocus={setFocus} />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {(['working', 'completed', 'idle', 'failed', 'unavailable'] as Status[]).map((s) => <li key={s} className="flex items-center gap-1.5"><Pill status={PILL_OF[s]} label={STATUS_TEXT[s]} /></li>)}
          </ul>
        </Panel>

        <Panel label="Workflow" title="Task decomposition & parallel execution">
          {!d.subQuestions.length ? <Empty>The orchestrator has not planned yet.</Empty> : (
            <ol className="space-y-2">
              {d.subQuestions.map((q, i) => {
                const written = events.some((e) => e.type === 'section_written' && (e.data as { index?: number }).index === i)
                return (
                  <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-2 border-b border-hair pb-2 text-sm">
                    <span className="font-mono text-xs text-accent-ink">Q{i + 1}</span>
                    <span className="text-ink">{q}<span className="block text-[11px] text-muted">Web Discovery → Contradiction Detection → Research Synthesis</span></span>
                    <Pill status={written ? 'done' : 'idle'} label={written ? 'section written' : 'pending'} />
                  </li>
                )
              })}
            </ol>
          )}
          <p className="mt-3 text-[11px] text-muted">Sections are written in parallel (LangGraph Send fan-out, one task per sub-question). Search → review repeats at most {maxRounds} round{maxRounds === 1 ? "" : "s"}; the loop also stops on the wall-clock timeout.</p>
        </Panel>
      </div>

      <h2 className="label mb-2 mt-6">Execution monitoring</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[ORCHESTRATOR, ...AGENTS].map((a) => {
          const s = a.key === 'apollo' ? st.apollo ?? 'idle' : statusOf(a)
          const p = perf(a, metrics)
          const prog = progress[a.key]
          return (
            <article
              key={a.key}
              onMouseEnter={() => setFocus(a.key)}
              onMouseLeave={() => setFocus(null)}
              className={`border bg-surface p-3.5 ${s === 'working' ? 'pulse-border border-accent-strong' : focus === a.key ? 'border-ink' : 'border-line'} ${s === 'unavailable' ? 'bg-workspace' : ''}`}
            >
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-semibold">{a.key === 'apollo' ? 'APOLLO orchestrator' : `${a.name} Agent`}</h3>
                  <p className="text-xs text-muted">{a.role}</p>
                </div>
                <Pill status={PILL_OF[s]} label={STATUS_TEXT[s]} />
              </header>
              {a.backedBy ? (
                <>
                  <p className="mt-2 font-mono text-[10.5px] text-muted">{a.backedBy}</p>
                  {currentTask(a.key, d, events) && <p className="mt-2 truncate text-xs text-ink" title={currentTask(a.key, d, events)}><span className="label mr-1">Task</span>{currentTask(a.key, d, events)}</p>}
                  {prog && <div className="mt-2 flex items-center gap-2"><Meter value={prog[0]} max={prog[1]} /><span className="font-mono text-[10.5px] text-muted">{prog[0]}/{prog[1]}</span></div>}
                  {outcome[a.key] && <p className="mt-2 text-xs text-ink">{outcome[a.key]}</p>}
                  {a.nodes.length > 0 && (
                    <p className="mt-2 font-mono text-[10.5px] text-muted">
                      {p.calls ? `${p.calls} calls${p.failed ? ` (${p.failed} failed)` : ''} · ${fmtSec(p.seconds)} · ${fmtInt(p.tokens)} tokens` : 'no metered calls yet'}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs text-muted">Not implemented in the backend. Needs {a.need}.</p>
              )}
            </article>
          )
        })}
      </div>

      <div className="mt-6">
        <p className="label mb-2">Agent-to-agent communication (event stream)</p>
        {events.length ? <ProgressFeed events={events} /> : <Panel><Empty>No messages yet.</Empty></Panel>}
      </div>
    </div>
  )
}

// Radial network: orchestrator in the middle, specialists around it. Implemented roles get solid
// links; links to working agents are blue; unimplemented roles are dashed.
function Network({ agents, statusOf, apollo, focus, setFocus }: {
  agents: Agent[]; statusOf: (a: Agent) => Status; apollo: Status; focus: string | null; setFocus: (k: string | null) => void
}) {
  const W = 600, H = 400, cx = W / 2, cy = H / 2, rx = 238, ry = 160
  const fill: Record<Status, string> = { idle: '#ffffff', working: '#e3efff', completed: '#e8f5ee', failed: '#fde8ea', unavailable: '#f5f6f7' }
  const stroke: Record<Status, string> = { idle: 'rgba(17,19,24,.35)', working: '#3b82f6', completed: '#2f9e6b', failed: '#ef6673', unavailable: 'rgba(17,19,24,.25)' }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Agent network: APOLLO orchestrator connected to ten specialist agents">
      {agents.map((a, i) => {
        const t = (i / agents.length) * Math.PI * 2 - Math.PI / 2
        const x = cx + rx * Math.cos(t), y = cy + ry * Math.sin(t)
        const s = statusOf(a)
        return (
          <line key={`l-${a.key}`} x1={cx} y1={cy} x2={x} y2={y} stroke={s === 'working' ? '#3b82f6' : focus === a.key ? '#111318' : 'rgba(17,19,24,.22)'} strokeWidth={s === 'working' || focus === a.key ? 1.6 : 1} strokeDasharray={s === 'unavailable' ? '4 4' : undefined} />
        )
      })}
      <g>
        <rect x={cx - 62} y={cy - 22} width={124} height={44} fill={apollo === 'working' ? '#e3efff' : '#111318'} stroke="#111318" />
        <text x={cx} y={cy - 2} textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="14" letterSpacing="2" fill={apollo === 'working' ? '#111318' : '#ffffff'}>APOLLO</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill={apollo === 'working' ? '#1f5fc8' : '#c9ced6'}>ORCHESTRATOR · {apollo.toUpperCase()}</text>
      </g>
      {agents.map((a, i) => {
        const t = (i / agents.length) * Math.PI * 2 - Math.PI / 2
        const x = cx + rx * Math.cos(t), y = cy + ry * Math.sin(t)
        const s = statusOf(a)
        return (
          <g key={a.key} tabIndex={0} onMouseEnter={() => setFocus(a.key)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(a.key)} onBlur={() => setFocus(null)} className="cursor-default focus:outline-none">
            <title>{`${a.name} Agent: ${s === 'unavailable' ? 'not implemented' : s}`}</title>
            <rect x={x - 58} y={y - 17} width={116} height={34} fill={fill[s]} stroke={focus === a.key ? '#111318' : stroke[s]} strokeWidth={focus === a.key ? 1.6 : 1} strokeDasharray={s === 'unavailable' ? '3 3' : undefined} />
            <text x={x} y={y - 2} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="600" fill="#111318">{a.name}</text>
            <text x={x} y={y + 10} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="7.5" fill="#68717d">{s === 'unavailable' ? 'NOT IMPLEMENTED' : s.toUpperCase()}</text>
          </g>
        )
      })}
    </svg>
  )
}
