// Pause, resume, or stop and edit the topic, while a run works (Live Report).
//   Pause:  the run waits after its current step (POST /pause); nothing in progress is cut short.
//   Resume: the SAME run carries on from there (POST /continue): plan, sources and progress kept.
//   Stop & edit topic: the run ends (POST /stop); an editor then restarts it as a new run with the
//   edited topic and the stopped run's depth, approval setting and documents (POST /restart).

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { btn, field } from '../ui'

const MIN = 3
const MAX = 300

export default function PauseEditPanel() {
  const { busy, stopping, stop, pausing, pause, unpause, restart, selected, d } = useStore()
  const paused = !busy && d.stopReason === 'stopped_by_user'
  const original = selected?.topic ?? ''
  const [topic, setTopic] = useState(original)
  const [sending, setSending] = useState(false)

  // A different run selected (or the run list caught up): start the editor from that run's topic.
  useEffect(() => setTopic(original), [original, selected?.run_id])

  if (!busy && !paused) return null

  if (busy) {
    const approval = d.planPending || !!d.gapsPending // waiting for the user already: no Pause then
    const message = stopping
      ? 'Stopping… the run ends at its next safe point, then you can edit the topic.'
      : d.paused
        ? 'Paused. Resume carries this run on from where it stopped; nothing starts over.'
        : pausing
          ? 'Pausing after the current step… the step in progress finishes first.'
          : approval
            ? 'The run is waiting for your approval below.'
            : 'Pause the research and resume it later, or stop it to change the topic.'
    return (
      // The buttons come first (left): the floating game panel sits on the right and could cover them there.
      <div className="mb-5 flex flex-wrap items-center gap-3 border border-line bg-surface px-4 py-3" role="region" aria-label="Pause or stop research">
        {!stopping && (d.paused || pausing) && (
          <button type="button" onClick={unpause} className={btn.primary}>Resume</button>
        )}
        {!stopping && !d.paused && !pausing && !approval && (
          <button type="button" onClick={pause} className={btn.secondary}>Pause</button>
        )}
        <button type="button" onClick={stop} disabled={stopping} className={btn.secondary}>
          {stopping ? 'Stopping…' : 'Stop & edit topic'}
        </button>
        <p className="min-w-0 flex-1 text-sm text-ink" aria-live="polite">{message}</p>
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
      <p className="label">Stopped by you</p>
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
