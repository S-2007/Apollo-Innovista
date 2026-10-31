// Topic input, max rounds, HITL toggle, demo-topic buttons and "clear cache".
// Submit is disabled while a run is active.

import { useEffect, useState } from 'react'
import { clearCache, getDemoTopics, type DemoTopic } from '../api'

type Props = {
  busy: boolean
  onStart: (topic: string, maxRounds: number, hitl: boolean) => void
}

export default function TopicForm({ busy, onStart }: Props) {
  const [topic, setTopic] = useState('')
  const [maxRounds, setMaxRounds] = useState(2)
  const [hitl, setHitl] = useState(false)
  const [demos, setDemos] = useState<DemoTopic[]>([])
  const [note, setNote] = useState('')

  useEffect(() => {
    getDemoTopics().then(setDemos).catch(() => setDemos([]))
  }, [])

  const clear = async () => {
    try {
      const r = await clearCache()
      setNote(`Cache cleared (${r.runs_forgotten} finished runs removed).`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not clear the cache.')
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (topic.trim().length >= 3) onStart(topic.trim(), maxRounds, hitl)
      }}
    >
      <label className="block text-sm font-medium text-zinc-700" htmlFor="topic">
        Research topic
      </label>
      <textarea
        id="topic"
        rows={2}
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="e.g. Impact of AI on Indian agriculture"
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
      />

      <div className="flex flex-wrap gap-2">
        {demos.map((d) => (
          <button
            key={d.label}
            type="button"
            disabled={busy}
            aria-label={`Demo: ${d.label}`}
            title={d.topic}
            onClick={() => setTopic(d.topic)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            Demo: {d.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={clear}
          className="ml-auto rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
        >
          Clear cache
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Max rounds
          <select
            value={maxRounds}
            onChange={(e) => setMaxRounds(Number(e.target.value))}
            className="rounded-md border border-zinc-300 px-2 py-1"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hitl} onChange={(e) => setHitl(e.target.checked)} />
          Approve plan and gaps myself (HITL)
        </label>
      </div>

      <button
        type="submit"
        disabled={busy || topic.trim().length < 3}
        className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-zinc-300"
      >
        {busy ? 'Research running…' : 'Start research'}
      </button>
      {note && <p className="text-xs text-zinc-500">{note}</p>}
    </form>
  )
}
