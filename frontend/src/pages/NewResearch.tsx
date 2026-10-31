// New Research: launch a run and follow it live: agents, pending human decisions and the
// event log. The same controls as the dashboard form, with suggestions inline.

import AgentStrip from '../components/AgentStrip'
import HitlPanel from '../components/HitlPanel'
import ProgressFeed from '../components/ProgressFeed'
import TopicForm from '../components/TopicForm'
import { go } from '../router'
import { useStore } from '../store'
import { Empty, PageHeader, Panel, btn } from '../ui'

export default function NewResearch() {
  const { busy, start, d, maxRounds, events, showHitl, answer, selected } = useStore()

  return (
    <div>
      <PageHeader kicker="02 · New research" title="Launch and monitor a research run" />
      <div className="space-y-5">
        <AgentStrip d={d} maxRounds={maxRounds} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <TopicForm busy={busy} onStart={async (t, r, h) => { if (await start(t, r, h)) go('live') }} />
            {showHitl &&
              (d.planPending
                ? <HitlPanel key={d.pendingAt} mode="plan" items={d.subQuestions} onAnswer={answer} />
                : <HitlPanel key={d.pendingAt} mode="gaps" items={d.gapsPending ?? []} onAnswer={answer} />)}
            {d.reportReady && (
              <Panel>
                <p className="text-sm text-ink" role="status">The report for this session is ready.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => go('reports')} className={btn.primary}>Open the report</button>
                  <button onClick={() => go('gaps')} className={btn.secondary}>What Apollo couldn't verify</button>
                </div>
              </Panel>
            )}
          </div>
          <div className="min-w-0">
            {selected && <p className="label mb-2 truncate" title={selected.topic}>Live feed · {selected.topic}</p>}
            {events.length ? <ProgressFeed events={events} /> : <Panel><Empty>The event log appears when a run starts.</Empty></Panel>}
          </div>
        </div>
      </div>
    </div>
  )
}
