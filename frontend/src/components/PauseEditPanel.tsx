// Pause & edit topic: while a run works, the user can pause it, change the research topic and
// restart. Pausing ends the run on the server at its next safe point (POST /stop); restarting
// starts a new run with the edited topic and the paused run's depth, approval setting and
// attached documents (POST /restart). Shown on the Live Report and the New Research page.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { btn, field } from '../ui'

const MIN = 3
const MAX = 300

export default function PauseEditPanel() {
  const { busy, stopping, stop, restart, selected, d } = useStore()
  const paused = !busy && d.stopReason === 'stopped_by_user'
  const original = selected?.topic ?? ''
  const [topic, setTopic] = useState(original)
  const [sending, setSending] = useState(false)

  // A different run selected (or the run list caught up): start the editor from that run's topic.
  useEffect(() => setTopic(original), [original, selected?.run_id])

  if (!busy && !paused) return null

  if (busy) {
    return (
      // The button comes first (left): the floating game panel sits on the right and could cover it there.
      <div className="mb-5 flex flex-wrap items-center gap-3 border border-line bg-surface px-4 py-3" role="region" aria-label="Pause research">
        <button type="button" onClick={stop} disabled={stopping} className={btn.secondary}>
          {stopping ? 'Pausing…' : 'Pause & edit topic'}
        </button>
        <p className="min-w-0 flex-1 text-sm text-ink">
          {stopping
            ? 'Pausing… the run stops at its next safe point, then you can edit the topic.'
            : 'Need to change the question? Pause the research, edit the topic and restart it.'}
        </p>
      </div>
    )
  }

  const clean = topic.trim()
  const valid = clean.length >= MIN && clean.length <= MAX
  return (
    <form
      className="neo-panel mb-5 border border-line bg-surface px-4 py-4"
      aria-label="Edit topic and restart"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid || sending) return
        setSending(true)
        await restart(clean)
        setSending(false)
      }}
    >
      <p className="label">Paused by you</p>
      <label htmlFor="restart-topic" className="mt-2 block text-sm font-medium text-ink">Research topic</label>
      <textarea
        id="restart-topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        rows={2}
        maxLength={MAX}
        className={`${field} mt-1.5 resize-y`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted">
          {clean === original.trim() ? 'Same topic: the research starts again from the beginning.' : 'Edited topic.'} The new run keeps this run’s depth, approval setting and attached documents.
          {!valid && clean.length > 0 && ` The topic needs ${MIN}–${MAX} characters.`}
        </p>
        <button type="submit" disabled={!valid || sending} className={btn.primary}>
          {sending ? 'Restarting…' : 'Update & restart research'}
        </button>
      </div>
    </form>
  )
}
