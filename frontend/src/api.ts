// Typed fetch wrappers for the Apollo backend contract, and the types for
// events, sources, claims and the report. Fields the UI reads are optional where
// the backend might omit them; derive.ts and the components supply fallbacks.

// ------------------------------------------------------------------ events

export type EventType =
  | 'plan'
  | 'search_started'
  | 'search_done'
  | 'search_results' // live: raw hits for one query, before pages are read and numbered
  | 'search_failed'
  | 'review'
  | 'gaps_pending'
  | 'section_draft' // live: a section's text while the LLM writes it (raw, before citation checks)
  | 'section_written'
  | 'report_written' // the full report text, before claim verification
  | 'verification'
  | 'contradictions'
  | 'report_ready'
  | 'warning' // non-terminal problem the run survived (backend extension, see README)
  | 'error'
  | 'complete'

export interface EventDataMap {
  plan: { sub_questions?: string[]; awaiting_approval?: boolean }
  search_started: { round?: number; index?: number; total?: number; query?: string }
  search_done: { round?: number; query?: string; result_count?: number; sources?: { id: string; title?: string; url: string }[] }
  search_results: { query?: string; results?: { title?: string; url: string }[] }
  search_failed: { round?: number; query?: string; reason?: string }
  review: { round?: number; complete?: boolean; gaps?: string[] }
  gaps_pending: { round?: number; gaps?: string[] }
  section_draft: { index?: number; text?: string }
  section_written: { section?: string; index?: number; citations?: number; not_found?: boolean; write_failed?: boolean; text?: string }
  report_written: { markdown?: string }
  verification: { verified?: number; partial?: number; not_found?: number; unchecked?: number }
  contradictions: { count?: number; reviews?: number; reviews_failed?: number }
  report_ready: Record<string, never>
  warning: { message?: string; details?: string[] }
  error: { message?: string }
  complete: { status?: 'complete' | 'failed'; stop_reason?: string }
}

/** A known event; `data` is narrowed by `type`. */
export type RunEvent = { [K in EventType]: { type: K; data: EventDataMap[K]; ts: number } }[EventType]

/** Anything else the stream might send; shown with a neutral fallback, never a crash. */
export type UnknownEvent = { type: string; data: Record<string, unknown>; ts: number }

export type AnyEvent = RunEvent | UnknownEvent

const KNOWN = new Set<string>([
  'plan', 'search_started', 'search_results', 'search_done', 'search_failed', 'review', 'gaps_pending', 'section_draft', 'section_written', 'report_written',
  'verification', 'contradictions', 'report_ready', 'warning', 'error', 'complete',
])

export const isKnown = (e: AnyEvent): e is RunEvent => KNOWN.has(e.type)

/** Parse one SSE message defensively: bad JSON or odd shapes become an UnknownEvent. */
export function parseEvent(raw: string): AnyEvent {
  try {
    const v: unknown = JSON.parse(raw)
    if (v && typeof v === 'object') {
      const o = v as { type?: unknown; data?: unknown; ts?: unknown }
      return {
        type: typeof o.type === 'string' ? o.type : 'unknown',
        data: o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {},
        ts: typeof o.ts === 'number' ? o.ts : Date.now(),
      } as AnyEvent
    }
  } catch {
    /* fall through */
  }
  return { type: 'unknown', data: {}, ts: Date.now() }
}

/** ts may be epoch seconds or milliseconds. */
export const toMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts)

// ------------------------------------------------------------------ REST types

export type ClaimStatus = 'verified' | 'partial' | 'not_found' | 'unchecked'

export interface Source {
  id: string
  title?: string
  url: string
  snippet?: string
  section?: number
  status?: string
  question?: string
  extracted_by?: string // "trafilatura" | "tavily_raw" | "snippet only"
  cited?: boolean
  claims?: Partial<Record<ClaimStatus, number>>
}

export interface Claim {
  claim: string
  status: ClaimStatus
  evidence?: string
  source_ids?: string[]
  similarity?: number // cosine similarity of the claim to its best-matching source sentence (0-1)
}

export interface Contradiction {
  source_a: string
  source_b: string
  claim: string
}

export interface SectionInfo {
  index: number
  question: string
  citations: number
  not_found: boolean
  write_failed?: boolean // every LLM failed: the section was not written (not a "not found")
  source_ids: string[]
}

export interface Report {
  topic?: string
  status?: string
  stop_reason?: string
  markdown: string
  references?: { id: string; title: string; url: string }[] // sources actually cited
  sources: Source[]
  verification: Claim[]
  contradictions?: Contradiction[]
  contradictions_html_path: string | null
  plan?: string[]
  rounds?: number
  errors?: string[]
  sections?: SectionInfo[]
  review_health?: ReviewHealth
  citation_check?: { citations: number; unique_cited: number; dangling: string[]; uncited_sources: number; sources: number }
}

/** Hermes reviews run / failed. Contradictions are only searched for in reviews that succeeded. */
export interface ReviewHealth {
  reviews: number
  reviews_failed: number
}

export interface Usage {
  llm_calls: number
  llm_failed: number
  prompt_tokens: number
  completion_tokens: number
  llm_seconds: number
  searches: number
  searches_failed: number
  search_seconds: number
}

export interface RunSummary {
  run_id: string
  topic: string
  status: 'running' | 'awaiting_input' | 'complete' | 'failed' | 'rejected'
  hitl: boolean
  max_rounds: number
  created_at: number
  finished_at: number | null
  rounds: number
  stop_reason: string | null
  sources: number
  claims: Record<ClaimStatus, number>
  contradictions: number
  reviews?: number
  reviews_failed?: number
  has_report: boolean
  usage: Usage
}

export interface UsageRow {
  name: string
  calls: number
  failed: number
  seconds: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd?: number
}

export interface MeterCall {
  kind: 'llm' | 'search'
  ok: boolean
  seconds: number
  node: string
  ts: number
  provider?: string
  model?: string
  prompt_tokens?: number
  completion_tokens?: number
  query?: string
  results?: number
  error?: string
}

export interface Metrics {
  summary: Usage
  by_node: UsageRow[]
  by_model: UsageRow[]
  calls: MeterCall[]
  stages: { stage: string; start: number; ms: number }[]
  cost_usd: number | null
  wall_ms: number
}

export interface SystemInfo {
  keys: Record<string, boolean>
  llm: { provider: string; groq_model: string; gemini_model: string; verify_chain: string[] }
  limits: Record<string, number>
  checks: {
    env_example_committed: boolean
    env_gitignored: boolean
    env_tracked_by_git: boolean | null
    cors_origins: string[]
    demo_switch: number
  }
  secret_scan: { ran: boolean; files: number; findings: { file: string; line: number; kind: string; match: string }[] }
}

export interface DemoTopic {
  id: string
  title: string
  topic: string
  note?: string | null
}

export type ResumeAction = 'approve' | 'edit' | 'reject' | 'skip'

// ------------------------------------------------------------------ fetch wrappers

/** Fired on window when any API call gets 401 (session missing or expired). */
export const SIGNED_OUT_EVENT = 'apollo:signed-out'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(url, init)
  } catch {
    throw new Error('Cannot reach the backend. Is uvicorn running on port 8000?')
  }
  if (resp.status === 401 && !url.startsWith('/api/auth/')) {
    // The session expired or was revoked: tell the app to show the sign-in screen.
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
  }
  if (!resp.ok) {
    const body: unknown = await resp.json().catch(() => null)
    const detail = (body as { detail?: unknown } | null)?.detail
    const msg =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail) // FastAPI validation errors: [{loc, msg}]
          ? detail.map((d: { msg?: string; loc?: unknown[] }) => `${(d.loc ?? []).slice(1).join('.')} ${d.msg ?? ''}`.trim()).join('; ')
          : `Request failed (${resp.status})`
    throw new Error(msg)
  }
  return resp.json() as Promise<T>
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const startRun = (topic: string, maxRounds: number, hitl: boolean) =>
  request<{ run_id: string }>('/api/runs', post({ topic, max_rounds: maxRounds, hitl }))

export const resumeRun = (runId: string, action: ResumeAction, payload?: { sub_questions?: string[]; gaps?: string[] }) =>
  request<{ ok: boolean }>(`/api/runs/${runId}/resume`, post(payload ? { action, payload } : { action }))

export const getReport = (runId: string) => request<Report>(`/api/runs/${runId}/report`)

export const listRuns = () => request<RunSummary[]>('/api/runs')
export const getMetrics = (runId: string) => request<Metrics>(`/api/runs/${runId}/metrics`)
export const getSystem = () => request<SystemInfo>('/api/system')

export const getDemoTopics = () => request<DemoTopic[]>('/api/demo-topics')

export const eventsUrl = (runId: string) => `/api/runs/${runId}/events`
export const reportDownloadUrl = (runId: string) => `/api/runs/${runId}/report.md`

// ------------------------------------------------------------------ accounts
// The session is a JWT in an HttpOnly cookie set by the backend; this code never sees the token.

export interface AuthUser {
  id: string
  email: string
  name: string
  created_at: number
}

export const authMe = () => request<{ user: AuthUser }>('/api/auth/me').then((r) => r.user)
export const authLogin = (email: string, password: string) =>
  request<{ user: AuthUser }>('/api/auth/login', post({ email, password })).then((r) => r.user)
export const authRegister = (name: string, email: string, password: string) =>
  request<{ user: AuthUser }>('/api/auth/register', post({ name, email, password })).then((r) => r.user)
export const authLogout = () => request<{ ok: boolean }>('/api/auth/logout', post({}))
