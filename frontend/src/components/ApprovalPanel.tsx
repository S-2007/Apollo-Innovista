// Human-in-the-loop approval for the two interrupts the graph can raise.
// Plan:  Approve | Edit (inline, each sub-question) | Reject (cancels the run)
// Gaps:  Approve all | Edit | Skip
// Shown only while the run is waiting for that decision.

import { useState } from 'react'
import type { Pending, ResumeAction } from '../api'

type Props = {
  pending: NonNullable<Pending>
  onAnswer: (action: ResumeAction, payload?: { plan?: string[]; gaps?: string[] }) => void
}

export default function ApprovalPanel({ pending, onAnswer }: Props) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState(pending.items)
  const isPlan = pending.kind === 'plan'

  const saveEdits = () => {
    const items = drafts.map((d) => d.trim()).filter(Boolean)
    if (items.length) onAnswer('edit', isPlan ? { plan: items } : { gaps: items })
  }

  return (
    <section className="rounded-lg border-2 border-indigo-300 bg-white p-4">
      <h2 className="text-sm font-semibold text-indigo-800">
        {isPlan ? 'Approve the research plan' : 'Approve Hermes’ follow-up queries'}
      </h2>
      <p className="mb-3 text-xs text-zinc-500">
        {isPlan
          ? 'Athena searches these sub-questions. Edit any of them before searching starts.'
          : 'Hermes found gaps. These queries run in the next round.'}
      </p>

      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
        {(editing ? drafts : pending.items).map((item, i) => (
          <li key={i}>
            {editing ? (
              <input
                aria-label={`${isPlan ? 'Sub-question' : 'Gap query'} ${i + 1}`}
                value={item}
                onChange={(e) => setDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)))}
                className="w-full rounded border border-zinc-300 px-2 py-1"
              />
            ) : (
              item
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2 text-sm">
        {editing ? (
          <>
            <button onClick={saveEdits} className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
              Save edits and continue
            </button>
            <button onClick={() => { setEditing(false); setDrafts(pending.items) }} className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => onAnswer('approve')} className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
              {isPlan ? 'Approve' : 'Approve all'}
            </button>
            <button onClick={() => setEditing(true)} className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100">
              Edit
            </button>
            <button
              onClick={() => onAnswer(isPlan ? 'reject' : 'skip')}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-100"
            >
              {isPlan ? 'Reject' : 'Skip'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
