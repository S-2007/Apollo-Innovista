// Run store: the one place pages get run data from. Holds the run list (polled), the
// selected run, its live events and derive() view, and its report and metrics once available.
// Pages never fetch run data themselves, so switching pages never restarts a stream.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  getMetrics, getReport, listRuns, resumeRun, startRun,
  type AnyEvent, type Metrics, type Report, type ResumeAction, type RunSummary,
} from './api'
import { derive, type Derived } from './derive'
import { useRunEvents } from './useRunEvents'

const LIST_POLL_MS = 4000
const METRICS_POLL_MS = 3000

export interface Store {
  runs: RunSummary[]
  runId: string | null
  selected: RunSummary | null
  select: (id: string) => void
  events: AnyEvent[]
  d: Derived
  maxRounds: number
  busy: boolean
  report: Report | null
  metrics: Metrics | null
  problem: string | null
  setProblem: (m: string | null) => void
  start: (topic: string, rounds: number, hitl: boolean) => Promise<boolean>
  answer: (action: ResumeAction, payload?: { sub_questions?: string[]; gaps?: string[] }) => Promise<void>
  showHitl: boolean
  refreshRuns: () => void
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [answeredAt, setAnsweredAt] = useState(-1) // event index of the last decision we sent
  const [problem, setProblem] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const stream = useRunEvents(runId)
  const selected = runs.find((r) => r.run_id === runId) ?? null
  const maxRounds = selected?.max_rounds ?? 2
  const d = derive(stream.events, maxRounds)
  const busy = runId !== null && !d.finished && !stream.connectionError
  const refreshRuns = useCallback(() => setTick((t) => t + 1), [])

  // Run list: polled, so runs started elsewhere (CLI tests, another tab) and status changes show up.
  useEffect(() => {
    let live = true
    const load = () =>
      listRuns()
        .then((list) => {
          if (!live) return
          setRuns(list)
          setListError(null) // a poll that works again clears the earlier failure
          setRunId((cur) => cur ?? list[0]?.run_id ?? null) // default: the newest run
        })
        .catch((e: unknown) => live && setListError(e instanceof Error ? `Run list: ${e.message}` : 'Could not load runs.'))
    load()
    const t = window.setInterval(load, LIST_POLL_MS)
    return () => {
      live = false
      window.clearInterval(t)
    }
  }, [tick])

  // Report: once the selected run says it is ready.
  useEffect(() => {
    setReport(null)
    if (!runId || !d.reportReady) return
    let live = true
    getReport(runId)
      .then((r) => live && setReport(r))
      .catch((e: unknown) => live && setProblem(e instanceof Error ? `Report: ${e.message}` : 'Could not load the report.'))
    return () => {
      live = false
    }
  }, [runId, d.reportReady])

  // Metrics: polled while the run is going, fetched once more when it ends.
  useEffect(() => {
    setMetrics(null)
    if (!runId) return
    let live = true
    const load = () => getMetrics(runId).then((m) => live && setMetrics(m)).catch(() => undefined)
    load()
    const t = busy ? window.setInterval(load, METRICS_POLL_MS) : undefined
    return () => {
      live = false
      if (t) window.clearInterval(t)
    }
  }, [runId, busy])

  const select = useCallback((id: string) => {
    setAnsweredAt(-1)
    setRunId(id)
  }, [])

  const start = async (topic: string, rounds: number, hitl: boolean) => {
    setProblem(null)
    try {
      const { run_id } = await startRun(topic, rounds, hitl)
      setAnsweredAt(-1)
      setRunId(run_id)
      refreshRuns()
      return true
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not start the run.')
      return false
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

  const showHitl = d.pendingAt > answeredAt && (d.planPending || d.gapsPending !== null)
  const connProblem = stream.connectionError ?? (d.status === 'failed' ? d.errorMsg : null)

  return (
    <Ctx.Provider
      value={{
        runs, runId, selected, select, events: stream.events, d, maxRounds, busy, report, metrics,
        problem: problem ?? listError ?? connProblem, setProblem, start, answer, showHitl, refreshRuns,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
