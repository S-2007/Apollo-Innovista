// Human-in-the-loop approval for the two interrupts the graph can raise.
// Plan:  Approve | Edit (inline, each sub-question) | Reject (cancels the run)
// Gaps:  Approve all | Edit | Skip
// Shown only while the run is waiting for that decision.

import { Check, Pencil, SkipForward, X } from 'lucide-react'
import { useState } from 'react'
import { ACTORS } from '../agents'
import type { Pending, ResumeAction } from '../api'

type Props = {
  pending: NonNullable<Pending>
  onAnswer: (action: ResumeAction, payload?: { plan?: string[]; gaps?: string[] }) => void
}

export default function ApprovalPanel({ pending, onAnswer }: Props) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState(pending.items)
  const isPlan = pending.kind === 'plan'
  const from = ACTORS[isPlan ? 'apollo' : 'hermes']

  const saveEdits = () => {
    const items = drafts.map((d) => d.trim()).filter(Boolean)
    if (items.length) onAnswer('edit', isPlan ? { plan: items } : { gaps: items })
  }

  const secondary = 'flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50'

  return (
    <section className="feed-in rounded-2xl border border-amber-300 bg-white p-5 shadow-lift ring-4 ring-amber-100" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${from.soft} ${from.text}`}>
          <from.Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {isPlan ? 'Review the research plan' : 'Approve the follow-up queries'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {isPlan
              ? 'Athena searches these sub-questions next. Edit any of them first.'
              : 'Hermes found gaps. These queries run in the next round.'}
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-2">
        {(editing ? drafts : pending.items).map((item, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="mt-2 w-4 shrink-0 text-right font-mono text-xs tabular-nums text-slate-400">{i + 1}</span>
            {editing ? (
              <textarea
                aria-label={`${isPlan ? 'Sub-question' : 'Gap query'} ${i + 1}`}
                value={item}
                rows={2}
                onChange={(e) => setDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)))}
                className="w-full resize-none rounded-lg border border-slate-300 px-2.5 py-1.5 leading-snug focus:border-apollo focus:outline-none focus:ring-4 focus:ring-apollo/10"
              />
            ) : (
              <p className="py-1 leading-snug text-slate-800">{item}</p>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        {editing ? (
          <>
            <button onClick={saveEdits} className="flex items-center gap-1.5 rounded-lg bg-apollo px-3.5 py-2 font-semibold text-white hover:bg-[#1d44ae]">
              <Check className="h-4 w-4" /> Save edits and continue
            </button>
            <button onClick={() => { setEditing(false); setDrafts(pending.items) }} className={secondary}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => onAnswer('approve')} className="flex items-center gap-1.5 rounded-lg bg-apollo px-3.5 py-2 font-semibold text-white hover:bg-[#1d44ae]">
              <Check className="h-4 w-4" /> {isPlan ? 'Approve' : 'Approve all'}
            </button>
            <button onClick={() => setEditing(true)} className={secondary}>
              <Pencil className="h-4 w-4" /> Edit
            </button>
            <button onClick={() => onAnswer(isPlan ? 'reject' : 'skip')} className={secondary}>
              {isPlan ? <X className="h-4 w-4" /> : <SkipForward className="h-4 w-4" />} {isPlan ? 'Reject' : 'Skip'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
