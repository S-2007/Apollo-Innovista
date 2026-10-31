// Page layout and run state. Left: form, approval panel, progress feed.
// Right: tabs with the report, sources, verification and conflicts.
// All state lives here and in useRunEvents; there is no other store.

import { useEffect, useState } from 'react'
import { getReport, pendingDecision, resumeRun, startRun, useRunEvents, type Report, type ResumeAction } from './api'
import ApprovalPanel from './components/ApprovalPanel'
import ContradictionsView from './components/ContradictionsView'
import ProgressFeed from './components/ProgressFeed'
import ReportView from './components/ReportView'
import SourcesTable from './components/SourcesTable'
import TopicForm from './components/TopicForm'
import VerificationTable from './components/VerificationTable'

const TABS = ['Report', 'Sources', 'Verification', 'Conflicts'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [tab, setTab] = useState<Tab>('Report')
  const [answeredAt, setAnsweredAt] = useState(-1) // event index of the last decision we answered
  const [problem, setProblem] = useState('')
  const events = useRunEvents(runId)

  const finished = events.some((e) => e.type === 'complete')
  const busy = runId !== null && !finished
  const pending = pendingDecision(events)
  const reportReady = events.some((e) => e.type === 'report_ready')

  useEffect(() => {
    if (runId && reportReady) getReport(runId).then(setReport).catch((e: Error) => setProblem(e.message))
  }, [runId, reportReady])

  const start = async (topic: string, maxRounds: number, hitl: boolean) => {
    setProblem('')
    setReport(null)
    setAnsweredAt(-1)
    try {
      setRunId((await startRun(topic, maxRounds, hitl)).run_id)
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

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Apollo</h1>
        <p className="text-sm text-zinc-500">
          Apollo plans, Athena searches the web, Hermes reviews for gaps and conflicts. Every claim cites a retrieved source.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <TopicForm busy={busy} onStart={start} />
          {problem && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{problem}</p>}
          {pending && pending.at > answeredAt && (
            <ApprovalPanel key={pending.at} pending={pending} onAnswer={answer} />
          )}
          <ProgressFeed events={events} />
        </div>

        <main className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4">
          <nav className="mb-4 flex gap-1 border-b border-zinc-200">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}
              >
                {t}
              </button>
            ))}
          </nav>
          {!report || !runId ? (
            <p className="py-6 text-sm text-zinc-500">
              {busy ? 'The report appears here when the run finishes.' : 'Start a run to see its report here.'}
            </p>
          ) : tab === 'Report' ? (
            <ReportView report={report} runId={runId} />
          ) : tab === 'Sources' ? (
            <SourcesTable sources={report.sources} />
          ) : tab === 'Verification' ? (
            <VerificationTable claims={report.verification} />
          ) : (
            <ContradictionsView report={report} />
          )}
        </main>
      </div>
    </div>
  )
}
