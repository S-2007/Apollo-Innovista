// TopicForm: topic textarea, demo-topic buttons loaded from /api/demo-topics, rounds
// select, human-approval checkbox, and a submit button disabled while a run is active.

import { useEffect, useState } from 'react'
import { getDemoTopics, type DemoTopic } from '../api'

// The backend enforces the project's hard limit of 2 research rounds (it rejects 3 with a 422),
// so the select offers only the values the backend accepts.
export const MAX_ROUNDS_OPTIONS = [1, 2] as const

type Props = {
  busy: boolean
  onStart: (topic: string, maxRounds: number, hitl: boolean) => void
  onError: (message: string) => void
}

export default function TopicForm({ busy, onStart, onError }: Props) {
  const [topic, setTopic] = useState('')
  const [maxRounds, setMaxRounds] = useState<number>(2)
  const [hitl, setHitl] = useState(false)
  const [demos, setDemos] = useState<DemoTopic[]>([])
  const ready = topic.trim().length >= 3

  useEffect(() => {
    getDemoTopics()
      .then((list) => setDemos(Array.isArray(list) ? list : []))
      .catch((e: unknown) => onError(e instanceof Error ? `Demo topics: ${e.message}` : 'Could not load demo topics.'))
  }, [onError])

  return (
    <form
      className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !busy) onStart(topic.trim(), maxRounds, hitl)
      }}
    >
      <label htmlFor="topic" className="font-display text-sm font-semibold tracking-wide text-zinc-100">
        Research topic
      </label>
      <textarea
        id="topic"
        rows={3}
        value={topic}
        disabled={busy}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="e.g. Impact of AI on Indian agriculture"
        className="mt-2 w-full resize-none rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-400 focus:border-accent/70 focus:outline-none disabled:opacity-60"
      />

      {demos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {demos.map((d) => (
            <button
              key={d.id}
              type="button"
              disabled={busy}
              aria-label={`Demo ${d.id}: ${d.title}`}
              title={d.note ? `${d.topic}\n${d.note}` : d.topic}
              onClick={() => setTopic(d.topic)}
              className="rounded-md border border-white/10 px-2.5 py-1.5 text-left font-mono text-xs text-zinc-300 hover:border-white/25 hover:text-zinc-100 disabled:opacity-50"
            >
              DEMO {d.id} <span className="text-zinc-400">· {d.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-zinc-300">
        <label className="flex items-center gap-2">
          Rounds
          <select
            value={maxRounds}
            disabled={busy}
            onChange={(e) => setMaxRounds(Number(e.target.value))}
            className="rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-zinc-100 disabled:opacity-60"
          >
            {MAX_ROUNDS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hitl}
            disabled={busy}
            onChange={(e) => setHitl(e.target.checked)}
            className="h-4 w-4 accent-cyan-400"
          />
          Human approval
        </label>
      </div>

      <button
        type="submit"
        disabled={busy || !ready}
        className="mt-4 w-full rounded-md bg-accent px-4 py-2.5 font-display text-sm font-semibold tracking-[0.12em] text-void hover:bg-cyan-300 disabled:bg-white/10 disabled:text-zinc-400"
      >
        {busy ? 'RUN IN PROGRESS' : 'LAUNCH'}
      </button>
    </form>
  )
}
