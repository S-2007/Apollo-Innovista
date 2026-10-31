// Composer: topic, demo topics, rounds (1–2), HITL switch, start, and "clear cache".
// Everything is disabled while a run is active.

import { ArrowRight, Eraser, LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clearCache, getDemoTopics, type DemoTopic } from '../api'

type Props = {
  busy: boolean
  onStart: (topic: string, maxRounds: number, hitl: boolean) => void
  runTopic?: string // set while a run is active: the form collapses to a compact card
  runRounds?: number
}

export default function TopicForm({ busy, onStart, runTopic, runRounds }: Props) {
  const [topic, setTopic] = useState('')
  const [maxRounds, setMaxRounds] = useState(2)
  const [hitl, setHitl] = useState(false)
  const [demos, setDemos] = useState<DemoTopic[]>([])
  const [note, setNote] = useState('')
  const ready = topic.trim().length >= 3

  useEffect(() => {
    getDemoTopics().then(setDemos).catch(() => setDemos([]))
  }, [])

  const clear = async () => {
    try {
      const r = await clearCache()
      setNote(`Cache cleared: ${r.runs_forgotten} finished run(s) removed.`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not clear the cache.')
    }
  }

  // While a run is active, a compact card keeps the approval panel and the feed above the fold.
  if (busy && runTopic) {
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-panel" aria-label="Current run">
        <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 text-apollo motion-safe:animate-spin" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Researching</p>
          <p className="mt-0.5 text-sm leading-snug text-slate-600">{runTopic}</p>
          <p className="mt-1.5 text-xs text-slate-500">
            Up to {runRounds} round{runRounds === 1 ? '' : 's'} · {hitl ? 'you approve each step' : 'runs on its own'}
          </p>
        </div>
      </section>
    )
  }

  return (
    <form
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !busy) onStart(topic.trim(), maxRounds, hitl)
      }}
    >
      <label htmlFor="topic" className="text-base font-semibold text-slate-900">
        What should Apollo research?
      </label>
      <textarea
        id="topic"
        rows={3}
        value={topic}
        disabled={busy}
        onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready && !busy) onStart(topic.trim(), maxRounds, hitl)
        }}
        placeholder="e.g. Impact of AI on Indian agriculture"
        className="mt-3 w-full resize-none rounded-xl border border-slate-300 bg-slate-50/60 px-3.5 py-3 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-apollo focus:bg-white focus:outline-none focus:ring-4 focus:ring-apollo/10 disabled:opacity-60"
      />

      {demos.length > 0 && (
        <div className="mt-3 space-y-2">
          {demos.map((d) => (
            <button
              key={d.label}
              type="button"
              disabled={busy}
              aria-label={`Demo: ${d.label}`}
              onClick={() => setTopic(d.topic)}
              className="group flex w-full items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2 text-left transition-colors hover:border-apollo/40 hover:bg-apollo-soft/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-apollo" />
              <span className="min-w-0 text-sm">
                <span className="font-medium text-slate-800">Demo {d.label.replace('Topic ', '')}</span>
                <span className="block truncate text-slate-500">{d.topic}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <span id="rounds-label">Rounds</span>
          <div role="radiogroup" aria-labelledby="rounds-label" className="flex rounded-lg bg-slate-100 p-0.5">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={maxRounds === n}
                disabled={busy}
                onClick={() => setMaxRounds(n)}
                className={`w-9 rounded-md py-1 text-sm font-medium tabular-nums transition-colors disabled:opacity-60 ${
                  maxRounds === n ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
          <input type="checkbox" className="peer sr-only" checked={hitl} disabled={busy} onChange={(e) => setHitl(e.target.checked)} />
          <span
            aria-hidden="true"
            className="relative h-5 w-9 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-apollo peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-apollo peer-disabled:opacity-60"
          />
          Let me approve the plan (HITL)
        </label>
      </div>

      <button
        type="submit"
        disabled={busy || !ready}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-apollo px-4 py-3 text-sm font-semibold text-white shadow-lift transition-colors hover:bg-[#1d44ae] disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
      >
        {busy ? (
          <>
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" /> Research running
          </>
        ) : (
          <>
            Start research <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span aria-live="polite">{note || 'Ctrl + Enter also starts a run.'}</span>
        <button
          type="button"
          disabled={busy}
          onClick={clear}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
        >
          <Eraser className="h-3.5 w-3.5" /> Clear cache
        </button>
      </div>
    </form>
  )
}
