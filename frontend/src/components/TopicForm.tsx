// Research command form: objective, research depth (= max research rounds, which the backend
// caps at 2), human approval, and suggested topics from /api/demo-topics. Controls the backend
// cannot honour yet (document upload, source preference, agent count) are shown disabled with
// the reason, so nothing pretends to work.

import { useEffect, useState } from 'react'
import { getDemoTopics, type DemoTopic } from '../api'
import { btn, field } from '../ui'

// The backend enforces the project's hard limit of 2 research rounds (it rejects 3 with a 422).
export const MAX_ROUNDS_OPTIONS = [1, 2] as const
const DEPTH = [
  { rounds: 1, label: 'Focused', hint: '1 search round' },
  { rounds: 2, label: 'Deep', hint: '2 rounds: Hermes can order follow-up searches' },
] as const

type Props = {
  busy: boolean
  onStart: (topic: string, maxRounds: number, hitl: boolean) => void
  onError: (message: string) => void
  compact?: boolean // dashboard version: suggestions are rendered by the page instead
  topic?: string
  onTopic?: (t: string) => void
}

export default function TopicForm({ busy, onStart, onError, compact, topic: outer, onTopic }: Props) {
  const [own, setOwn] = useState('')
  const topic = outer ?? own
  const setTopic = onTopic ?? setOwn
  const [maxRounds, setMaxRounds] = useState<number>(2)
  const [hitl, setHitl] = useState(false)
  const [demos, setDemos] = useState<DemoTopic[]>([])
  const ready = topic.trim().length >= 3

  useEffect(() => {
    if (compact) return
    getDemoTopics()
      .then((list) => setDemos(Array.isArray(list) ? list : []))
      .catch((e: unknown) => onError(e instanceof Error ? `Demo topics: ${e.message}` : 'Could not load demo topics.'))
  }, [onError, compact])

  return (
    <form
      className="border border-line bg-surface"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !busy) onStart(topic.trim(), maxRounds, hitl)
      }}
    >
      <div className="p-4">
        <label htmlFor="topic" className="label">Research objective</label>
        <textarea
          id="topic"
          rows={3}
          value={topic}
          disabled={busy}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Measured yield impact of AI crop advisory apps for smallholder farmers in Odisha"
          className={`${field} mt-1.5 resize-none font-display text-[15px]`}
        />
        <p className="mt-1 text-[11px] text-muted">3–300 characters. The report uses retrieved sources only; unsupported points say "not found in sources".</p>

        {!compact && demos.length > 0 && (
          <div className="mt-3">
            <p className="label">Suggested topics</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {demos.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={busy}
                  aria-label={`Demo ${d.id}: ${d.title}`}
                  title={d.note ? `${d.topic}\n${d.note}` : d.topic}
                  onClick={() => setTopic(d.topic)}
                  className="border border-line px-2.5 py-1 text-left text-xs text-ink hover:border-accent-strong disabled:opacity-50"
                >
                  <span className="font-mono text-accent-ink">DEMO {d.id}</span> · {d.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-px border-t border-line bg-hair sm:grid-cols-2">
        <div className="bg-surface p-4">
          <p id="depth-label" className="label mb-1.5">Research depth</p>
          <div role="radiogroup" aria-labelledby="depth-label" className="flex gap-2">
            {DEPTH.map((o) => (
              <label key={o.rounds} className={`flex flex-1 cursor-pointer flex-col border px-2.5 py-1.5 ${maxRounds === o.rounds ? 'border-accent-strong bg-accent/10' : 'border-line'} ${busy ? 'opacity-60' : ''}`}>
                <span className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="depth" value={o.rounds} checked={maxRounds === o.rounds} disabled={busy} onChange={() => setMaxRounds(o.rounds)} className="accent-[#3b82f6]" />
                  {o.label}
                </span>
                <span className="text-[11px] text-muted">{o.hint}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="bg-surface p-4">
          <p className="label mb-1.5">Human approval</p>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={hitl} disabled={busy} onChange={(e) => setHitl(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#3b82f6]" />
            <span>Approve the plan and follow-up queries before they run<span className="block text-[11px] text-muted">Off: the run proceeds automatically.</span></span>
          </label>
        </div>
        <div className="bg-surface p-4">
          <label htmlFor="src-pref" className="label">Source preference</label>
          <select id="src-pref" disabled className={`${field} mt-1.5 py-1.5`} aria-describedby="src-pref-note">
            <option>Open web (Tavily, Serper fallback)</option>
          </select>
          <p id="src-pref-note" className="mt-1 text-[11px] text-muted">Only option the backend supports; academic-only or domain filters need a search-filter API field.</p>
        </div>
        <div className="bg-surface p-4">
          <label htmlFor="agent-count" className="label">Agents</label>
          <select id="agent-count" disabled className={`${field} mt-1.5 py-1.5`} aria-describedby="agent-note">
            <option>3: Apollo · Athena · Hermes</option>
          </select>
          <p id="agent-note" className="mt-1 text-[11px] text-muted">Fixed by the LangGraph pipeline; not configurable per run.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line p-4">
        <button type="button" disabled className={btn.secondary} aria-describedby="attach-note">Attach document</button>
        <span id="attach-note" className="text-[11px] text-muted">Upload not supported: the API accepts a topic only.</span>
        <button type="submit" disabled={busy || !ready} className={`${btn.primary} ml-auto min-w-[180px]`}>
          {busy ? 'Research in progress' : 'Initiate research →'}
        </button>
      </div>
    </form>
  )
}
