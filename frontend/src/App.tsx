// App: layout and orchestration. Owns the run id, the fetched report and the active tab;
// everything about the run's progress comes from derive(events), never from raw graph data.

import { useCallback, useEffect, useState } from 'react'
import { getReport, resumeRun, startRun, type Report, type ResumeAction } from './api'
import AgentStrip from './components/AgentStrip'
import HitlPanel from './components/HitlPanel'
import { ConflictsView, SourcesTable, VerificationTable } from './components/Panels'
import ProgressFeed from './components/ProgressFeed'
import ReportView from './components/ReportView'
import TopicForm from './components/TopicForm'
import { derive } from './derive'
import { useRunEvents } from './useRunEvents'

const TABS = ['Report', 'Sources', 'Verification', 'Conflicts'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const [runId, setRunId] = useState<string | null>(null)
  const [maxRounds, setMaxRounds] = useState(2)
  const [report, setReport] = useState<Report | null>(null)
  const [tab, setTab] = useState<Tab>('Report')
  const [answeredAt, setAnsweredAt] = useState(-1) // event index of the last decision we sent
  const [problem, setProblem] = useState<string | null>(null)

  const stream = useRunEvents(runId)
  const d = derive(stream.events, maxRounds)
  const busy = runId !== null && !d.finished && !stream.connectionError
  const reportError = useCallback((m: string) => setProblem(m), [])

  useEffect(() => {
    if (!runId || !d.reportReady) return
    let live = true
    getReport(runId)
      .then((r) => live && setReport(r))
      .catch((e: unknown) => live && setProblem(e instanceof Error ? `Report: ${e.message}` : 'Could not load the report.'))
    return () => {
      live = false
    }
  }, [runId, d.reportReady])

  const start = async (topic: string, rounds: number, hitl: boolean) => {
    setProblem(null)
    setReport(null)
    setAnsweredAt(-1)
    setTab('Report')
    try {
      const { run_id } = await startRun(topic, rounds, hitl)
      setMaxRounds(rounds)
      setRunId(run_id)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not start the run.')
    }
  }

  const answer = async (action: ResumeAction, payload?: { sub_questions?: string[]; gaps?: string[] }) => {
    if (!runId) return
    setAnsweredAt(d.pendingAt) // hide the panel now; the next events confirm the decision
    try {
      await resumeRun(runId, action, payload)
    } catch (e) {
      setAnsweredAt(-1)
      setProblem(e instanceof Error ? e.message : 'Could not send the decision.')
    }
  }

  const headerMsg = problem ?? stream.connectionError ?? (d.status === 'failed' ? d.errorMsg : null)
  const showHitl = d.pendingAt > answeredAt && (d.planPending || d.gapsPending !== null)

  return (
    <div className="mx-auto min-h-screen max-w-[1440px] px-4 py-5 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-white/10 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[0.3em] text-zinc-50">APOLLO</h1>
          <p className="mt-0.5 text-sm text-zinc-400">Multi-agent deep research · every claim cites a retrieved source</p>
        </div>
        {headerMsg && (
          <p role="alert" className="max-w-xl font-mono text-xs text-amber-300">
            ! {headerMsg}
          </p>
        )}
      </header>

      <AgentStrip d={d} maxRounds={maxRounds} />

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4">
          <TopicForm busy={busy} onStart={start} onError={reportError} />
          <ProgressFeed events={stream.events} />
          {showHitl &&
            (d.planPending ? (
              <HitlPanel key={d.pendingAt} mode="plan" items={d.subQuestions} onAnswer={answer} />
            ) : (
              <HitlPanel key={d.pendingAt} mode="gaps" items={d.gapsPending ?? []} onAnswer={answer} />
            ))}
        </aside>

        <main className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03]">
          <nav aria-label="Results" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-white/10 px-2">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t ? 'page' : undefined}
                className={`-mb-px shrink-0 border-b-2 px-3 py-3 font-display text-sm tracking-wide ${
                  tab === t ? 'border-accent text-zinc-50' : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t}
                {report && t !== 'Report' && (
                  <span className="ml-1.5 font-mono text-xs text-zinc-400">
                    {t === 'Sources' ? report.sources.length : t === 'Verification' ? report.verification.length : report.contradictions_html_path ? '!' : 0}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="p-4 sm:p-6">
            {!runId ? (
              <p className="py-10 text-center text-sm text-zinc-400">Choose a topic and press LAUNCH. The report appears here when the run finishes.</p>
            ) : !report ? (
              <p className="py-10 text-center font-mono text-sm text-zinc-400">
                {busy ? 'Report pending: sections are written after the research rounds.' : 'This run ended without a report.'}
              </p>
            ) : tab === 'Report' ? (
              <ReportView report={report} runId={runId} />
            ) : tab === 'Sources' ? (
              <SourcesTable sources={report.sources ?? []} />
            ) : tab === 'Verification' ? (
              <VerificationTable claims={report.verification ?? []} />
            ) : (
              <ConflictsView path={report.contradictions_html_path} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
