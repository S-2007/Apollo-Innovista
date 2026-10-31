// Page layout and run state. Header: mark, agent legend, and the live stage rail.
// Left: composer, approval panel, activity feed. Right: report, sources,
// verification and conflicts. All state lives here and in useRunEvents.

import { Check, CircleDashed, LoaderCircle, Hand, Minus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ACTORS, ApolloMark, type Actor } from './agents'
import {
  getReport,
  pendingDecision,
  resumeRun,
  startRun,
  useRunEvents,
  type Pending,
  type Report,
  type ResumeAction,
  type RunEvent,
} from './api'
import ApprovalPanel from './components/ApprovalPanel'
import ContradictionsView from './components/ContradictionsView'
import ProgressFeed from './components/ProgressFeed'
import ReportView from './components/ReportView'
import SourcesTable from './components/SourcesTable'
import TopicForm from './components/TopicForm'
import VerificationTable from './components/VerificationTable'

const TABS = ['Report', 'Sources', 'Verification', 'Conflicts'] as const
type Tab = (typeof TABS)[number]

// ------------------------------------------------------------------ stage rail

type StageStatus = 'pending' | 'active' | 'waiting' | 'done' | 'skipped' | 'failed'
type Stage = { label: string; actor: Actor; status: StageStatus }

/** Where the run is, derived only from events the backend has sent. */
function buildStages(events: RunEvent[], maxRounds: number, pending: Pending): Stage[] {
  const has = (p: (e: RunEvent) => boolean) => events.some(p)
  const verdict = (r: number) => has((e) => e.type === 'review' && e.data.round === r && 'complete' in e.data)
  const searched = (r: number) => has((e) => e.type === 'search_started' && e.data.round === r)
  const searchFinished = (r: number) => has((e) => (e.type === 'search_done' || e.type === 'search_failed') && e.data.round === r)
  const stop = events.find((e) => e.type === 'review' && !!e.data.stop_reason)
  const stopRound = stop && stop.type === 'review' ? stop.data.round : Infinity
  const end = events.find((e) => e.type === 'complete')
  const failed = !!end && end.type === 'complete' && end.data.status !== 'complete'
  const lastPlan = [...events].reverse().find((e) => e.type === 'plan')
  const planSize = lastPlan && lastPlan.type === 'plan' ? lastPlan.data.plan.length : 0
  const sections = events.filter((e) => e.type === 'section_written').length
  const verified = has((e) => e.type === 'verification')
  const pendingEvent = pending ? events[pending.at] : undefined
  const gapsRound = pendingEvent?.type === 'gaps_pending' ? pendingEvent.data.round : null

  const stages: Stage[] = [
    {
      label: 'Plan',
      actor: 'apollo',
      status: has((e) => e.type === 'plan' && !!e.data.approved) ? 'done' : pending?.kind === 'plan' ? 'waiting' : 'active',
    },
  ]
  for (let r = 1; r <= maxRounds; r++) {
    const skipped = r > stopRound
    stages.push({
      label: maxRounds > 1 ? `Search ${r}` : 'Search',
      actor: 'athena',
      status: skipped ? 'skipped' : searchFinished(r) ? 'done' : searched(r) ? 'active' : 'pending',
    })
    stages.push({
      label: maxRounds > 1 ? `Review ${r}` : 'Review',
      actor: 'hermes',
      status: skipped
        ? 'skipped'
        : r === gapsRound
          ? 'waiting'
          : verdict(r)
            ? 'done'
            : searchFinished(r)
              ? 'active'
              : 'pending',
    })
  }
  stages.push({ label: 'Write', actor: 'apollo', status: planSize && sections >= planSize ? 'done' : stop ? 'active' : 'pending' })
  stages.push({ label: 'Verify', actor: 'verify', status: verified ? 'done' : planSize && sections >= planSize ? 'active' : 'pending' })
  stages.push({ label: failed ? 'Stopped' : 'Done', actor: 'apollo', status: failed ? 'failed' : end ? 'done' : 'pending' })

  if (failed)
    return stages.map((s) =>
      s.status === 'active' || s.status === 'waiting' ? { ...s, status: 'failed' } : s.status === 'pending' ? { ...s, status: 'skipped' } : s,
    )
  return stages
}

function StageRail({ stages }: { stages: Stage[] }) {
  return (
    <ol className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1 text-xs [scrollbar-width:thin]" aria-label="Run progress">
      {stages.map((s, i) => {
        const a = ACTORS[s.actor]
        const icon =
          s.status === 'done' ? <Check className="h-3.5 w-3.5" /> :
          s.status === 'active' ? <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" /> :
          s.status === 'waiting' ? <Hand className="h-3.5 w-3.5" /> :
          s.status === 'failed' ? <X className="h-3.5 w-3.5" /> :
          s.status === 'skipped' ? <Minus className="h-3.5 w-3.5" /> :
          <CircleDashed className="h-3.5 w-3.5" />
        const style =
          s.status === 'done' ? `${a.soft} ${a.text}` :
          s.status === 'active' ? `${a.solid} text-white shadow-sm` :
          s.status === 'waiting' ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' :
          s.status === 'failed' ? 'bg-red-100 text-red-800' :
          'bg-white text-slate-400 ring-1 ring-slate-200'
        return (
          <li key={s.label} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span className={`h-px w-4 ${s.status === 'pending' || s.status === 'skipped' ? 'bg-slate-300' : 'bg-slate-400'}`} />}
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${style} ${s.status === 'skipped' ? 'line-through decoration-slate-300' : ''}`}
              title={`${s.label}: ${s.status === 'waiting' ? 'waiting for you' : s.status}`}
            >
              {icon}
              {s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ------------------------------------------------------------------ empty states

function HowItWorks() {
  const steps: { actor: Actor; text: string }[] = [
    { actor: 'apollo', text: 'splits your topic into 3–5 sub-questions you can approve or edit' },
    { actor: 'athena', text: 'searches the web and reads the pages it finds' },
    { actor: 'hermes', text: 'looks for gaps and conflicting sources, and asks for a second round if needed' },
    { actor: 'apollo', text: 'writes each section only from its own sources; every claim carries a citation' },
    { actor: 'verify', text: 'checks each cited sentence against the retrieved text' },
  ]
  return (
    <div className="mx-auto max-w-xl py-10">
      <h2 className="text-lg font-semibold">What happens when you start a run</h2>
      <ol className="mt-5 space-y-0">
        {steps.map((s, i) => {
          const a = ACTORS[s.actor]
          return (
            <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
              {i < steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-slate-200" />}
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${a.soft} ${a.text}`}>
                <a.Icon className="h-4 w-4" />
              </span>
              <p className="pt-1 text-sm text-slate-600">
                <span className={`font-semibold ${a.text}`}>{a.name}</span> {s.text}
              </p>
            </li>
          )
        })}
      </ol>
      <p className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-500">
        Pick a demo topic on the left, or type your own, then press <span className="font-medium text-slate-700">Start research</span>.
      </p>
    </div>
  )
}

// ------------------------------------------------------------------ app

export default function App() {
  const [runId, setRunId] = useState<string | null>(null)
  const [runRounds, setRunRounds] = useState(2)
  const [runTopic, setRunTopic] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [tab, setTab] = useState<Tab>('Report')
  const [answeredAt, setAnsweredAt] = useState(-1) // event index of the last decision we answered
  const [problem, setProblem] = useState('')
  const events = useRunEvents(runId)

  const end = events.find((e) => e.type === 'complete')
  const busy = runId !== null && !end
  const pending = pendingDecision(events)
  const reportReady = events.some((e) => e.type === 'report_ready')
  const stages = runId ? buildStages(events, runRounds, pending) : []
  const current = stages.find((s) => s.status === 'active' || s.status === 'waiting')

  useEffect(() => {
    if (runId && reportReady) getReport(runId).then(setReport).catch((e: Error) => setProblem(e.message))
  }, [runId, reportReady])

  const start = async (topic: string, maxRounds: number, hitl: boolean) => {
    setProblem('')
    setReport(null)
    setAnsweredAt(-1)
    setTab('Report')
    try {
      const { run_id } = await startRun(topic, maxRounds, hitl)
      setRunRounds(maxRounds)
      setRunTopic(topic)
      setRunId(run_id)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not start the run.')
    }
  }

  const answer = async (action: ResumeAction, payload?: { plan?: string[]; gaps?: string[] }) => {
    if (!runId || !pending) return
    setAnsweredAt(pending.at) // hide the panel at once; the next event confirms the decision
    try {
      await resumeRun(runId, action, payload)
    } catch (e) {
      setAnsweredAt(-1)
      setProblem(e instanceof Error ? e.message : 'Could not send the decision.')
    }
  }

  const counts: Partial<Record<Tab, number>> = report
    ? { Sources: report.sources.length, Verification: report.verification.length, Conflicts: report.contradictions.length }
    : {}

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3 text-slate-900">
            <ApolloMark className="h-9 w-9" />
            <div>
              <h1 className="text-xl font-semibold leading-tight">Apollo</h1>
              <p className="text-sm text-slate-500">Deep research where every claim cites a source it actually read</p>
            </div>
          </div>
          <ul className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Agents">
            {(['apollo', 'athena', 'hermes'] as const).map((k) => {
              const a = ACTORS[k]
              return (
                <li key={k} className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${a.soft} ${a.text}`}>
                    <a.Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-medium">{a.name}</span>
                  <span className="hidden text-slate-500 xl:inline">{a.role}</span>
                </li>
              )
            })}
          </ul>
        </div>
        {runId && (
          <div className="border-t border-slate-100 bg-slate-50/70">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
              <StageRail stages={stages} />
              <p className="ml-auto text-xs text-slate-500" aria-live="polite">
                {current?.status === 'waiting'
                  ? 'Waiting for your decision'
                  : current
                    ? `${ACTORS[current.actor].name} is working: ${current.label.toLowerCase()}`
                    : end && end.type === 'complete'
                      ? `Finished: ${end.data.status}`
                      : ''}
              </p>
            </div>
          </div>
        )}
      </header>

      {/* minmax(0, …) and min-w-0: the demo chips' single-line text must not widen the column past the screen */}
      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-5">
          <TopicForm busy={busy} onStart={start} runTopic={busy ? runTopic : undefined} runRounds={runRounds} />
          {problem && (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {problem}
            </p>
          )}
          {pending && pending.at > answeredAt && <ApprovalPanel key={pending.at} pending={pending} onAnswer={answer} />}
          <ProgressFeed events={events} />
        </aside>

        <main className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-panel">
          {report && (
          <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 px-3 sm:px-5" aria-label="Results">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t ? 'page' : undefined}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3.5 text-sm transition-colors ${
                  tab === t ? 'border-apollo font-semibold text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t}
                {counts[t] !== undefined && (
                  <span className={`rounded-full px-1.5 text-xs tabular-nums ${tab === t ? 'bg-apollo-soft text-apollo' : 'bg-slate-100 text-slate-500'}`}>
                    {counts[t]}
                  </span>
                )}
              </button>
            ))}
          </nav>
          )}
          <div className="p-5 sm:p-8">
            {!runId ? (
              <HowItWorks />
            ) : !report ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <ApolloMark className="h-12 w-12 text-slate-300" />
                <p className="text-sm text-slate-600">
                  {busy ? 'The report appears here once the sections are written and every claim is checked.' : 'This run ended without a report.'}
                </p>
              </div>
            ) : tab === 'Report' ? (
              <ReportView report={report} runId={runId} rounds={end && end.type === 'complete' ? end.data.rounds : undefined} />
            ) : tab === 'Sources' ? (
              <SourcesTable sources={report.sources} />
            ) : tab === 'Verification' ? (
              <VerificationTable claims={report.verification} />
            ) : (
              <ContradictionsView report={report} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
