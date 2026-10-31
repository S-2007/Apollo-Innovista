// Typed wrappers for the FastAPI backend, and useRunEvents: the SSE hook.
// Event types mirror events.py exactly; the UI never sees raw graph state.

import { useEffect, useState } from 'react'

// ------------------------------------------------------------------ events

export type RunEvent =
  | Ev<'plan', { plan: string[]; pending: boolean; approved?: boolean }>
  | Ev<'search_started', { round: number; queries: string[] }>
  | Ev<'search_done', { round: number; query: string; new_sources: number; sources: { id: string; title: string; url: string }[] }>
  | Ev<'search_failed', { round: number; query: string; reason: string }>
  | Ev<'review', { round: number; complete?: boolean; gaps?: string[] | null; contradictions?: number; gaps_decision?: string; stop_reason?: string; status?: string }>
  | Ev<'gaps_pending', { round: number; gaps: string[] }>
  | Ev<'section_written', { index: number; question: string; citations: number; not_found: boolean }>
  | Ev<'verification', { total: number; counts: Record<ClaimStatus, number> }>
  | Ev<'contradictions', { count: number; message: string; url: string | null }>
  | Ev<'report_ready', { url: string }>
  | Ev<'error', { fatal: boolean; node: string; count: number; messages: string[] }>
  | Ev<'complete', { status: string; stop_reason: string; rounds?: number }>

type Ev<T extends string, D> = { type: T; data: D; ts: string }

export type ClaimStatus = 'verified' | 'partial' | 'not_found' | 'unchecked'

/** The human decision the run is currently waiting for, derived from the event stream. */
export type Pending = { kind: 'plan'; items: string[]; at: number } | { kind: 'gaps'; items: string[]; at: number } | null

export function pendingDecision(events: RunEvent[]): Pending {
  let pending: Pending = null
  events.forEach((e, i) => {
    if (e.type === 'plan') pending = e.data.pending ? { kind: 'plan', items: e.data.plan, at: i } : null
    else if (e.type === 'gaps_pending') pending = { kind: 'gaps', items: e.data.gaps, at: i }
    else if ((e.type === 'review' && e.data.gaps_decision) || e.type === 'complete') pending = null
  })
  return pending
}

/** Subscribe to a run's SSE stream. EventSource reconnects by itself (sending Last-Event-ID).
 *  Events are stored with the run id they belong to, so a new run never sees the previous run's events. */
export function useRunEvents(runId: string | null): RunEvent[] {
  const [stream, setStream] = useState<{ runId: string | null; events: RunEvent[] }>({ runId: null, events: [] })
  useEffect(() => {
    if (!runId) return
    const source = new EventSource(`/api/runs/${runId}/events`)
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as RunEvent
      setStream((prev) => ({ runId, events: prev.runId === runId ? [...prev.events, event] : [event] }))
      if (event.type === 'complete') source.close() // otherwise the browser would reconnect
    }
    return () => source.close()
  }, [runId])
  return stream.runId === runId ? stream.events : []
}

// ------------------------------------------------------------------ REST

export type DemoTopic = { label: string; topic: string }

export type Source = {
  id: string
  title: string
  url: string
  snippet: string
  section: number
  question: string
  extracted_by: string
  cited: boolean
  claims: Partial<Record<ClaimStatus, number>>
}

export type Claim = {
  claim: string
  source_ids: string[]
  status: ClaimStatus
  best_match: string
  similarity: number
  evidence: string
}

export type Report = {
  topic: string
  status: string
  stop_reason: string
  markdown: string
  references: { id: string; title: string; url: string }[]
  sources: Source[]
  verification: Claim[]
  contradictions: { source_a: string; source_b: string; claim: string }[]
  contradictions_html_path: string | null
}

export type ResumeAction = 'approve' | 'edit' | 'reject' | 'skip'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init)
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${resp.status})`)
  }
  return resp.json() as Promise<T>
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const startRun = (topic: string, maxRounds: number, hitl: boolean) =>
  request<{ run_id: string }>('/api/runs', json({ topic, max_rounds: maxRounds, hitl }))

export const resumeRun = (runId: string, action: ResumeAction, payload?: { plan?: string[]; gaps?: string[] }) =>
  request<{ ok: boolean }>(`/api/runs/${runId}/resume`, json({ action, payload }))

export const getReport = (runId: string) => request<Report>(`/api/runs/${runId}/report`)

export const getDemoTopics = () => request<DemoTopic[]>('/api/demo-topics')

export const clearCache = () => request<{ runs_forgotten: number; output_dirs_removed: number }>('/api/cache/clear', { method: 'POST' })

export const reportDownloadUrl = (runId: string) => `/api/runs/${runId}/report.md`
