// New Research: topic form, the agents, the live event feed and any pending human decision.

import { useCallback } from 'react'
import AgentStrip from '../components/AgentStrip'
import HitlPanel from '../components/HitlPanel'
import ProgressFeed from '../components/ProgressFeed'
import TopicForm from '../components/TopicForm'
import { go } from '../router'
import { useStore } from '../store'
import { Card } from '../ui'

export default function NewResearch() {
  const { busy, start, setProblem, d, maxRounds, events, showHitl, answer, selected } = useStore()
  const onError = useCallback((m: string) => setProblem(m), [setProblem])

  return (
    <div className="space-y-5">
      <AgentStrip d={d} maxRounds={maxRounds} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <TopicForm busy={busy} onStart={(t, r, h) => void start(t, r, h)} onError={onError} />
          {showHitl &&
            (d.planPending ? (
              <HitlPanel key={d.pendingAt} mode="plan" items={d.subQuestions} onAnswer={answer} />
            ) : (
              <HitlPanel key={d.pendingAt} mode="gaps" items={d.gapsPending ?? []} onAnswer={answer} />
            ))}
          {d.reportReady && (
            <Card>
              <p className="text-sm text-zinc-300">The report is ready.</p>
              <button onClick={() => go('reports')} className="mt-3 rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 font-display text-sm text-accent hover:bg-accent hover:text-void">
                Open the report
              </button>
            </Card>
          )}
        </div>
        <div className="min-w-0">
          {selected && <p className="mb-2 truncate text-sm text-zinc-400" title={selected.topic}>Live feed · {selected.topic}</p>}
          <ProgressFeed events={events} />
        </div>
      </div>
    </div>
  )
}
