// Research Gaps: everything the run could NOT establish: sub-questions answered
// "not found in sources", claims without support, failed searches, follow-up queries
// that never ran, and non-fatal problems the run survived.

import { isKnown } from '../api'
import { useStore } from '../store'
import { Card, Empty, NeedsRun, Pill, Stat } from '../ui'

export default function Gaps() {
  const { report, busy, events } = useStore()
  if (!report) return <NeedsRun what="Research gaps" busy={busy} />

  const failed: { query: string; reason: string }[] = []
  const ran = new Set<string>()
  const proposed: string[] = []
  for (const e of events) {
    if (!isKnown(e)) continue
    if (e.type === 'search_failed') failed.push({ query: e.data.query ?? '', reason: e.data.reason ?? '' })
    if (e.type === 'search_started' && e.data.query) ran.add(e.data.query)
    if (e.type === 'review') proposed.push(...(e.data.gaps ?? []))
  }
  const notRun = [...new Set(proposed)].filter((g) => !ran.has(g))
  const notFoundSections = (report.sections ?? []).filter((s) => s.not_found)
  const weak = report.verification.filter((c) => c.status === 'not_found' || c.status === 'unchecked')
  const problems = (report.errors ?? []).filter((e) => !e.startsWith('search['))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Unanswered sub-questions" value={notFoundSections.length} tone={notFoundSections.length ? 'bad' : 'good'} />
        <Stat label="Unsupported claims" value={weak.filter((c) => c.status === 'not_found').length} sub={`${weak.filter((c) => c.status === 'unchecked').length} unchecked`} tone="warn" />
        <Stat label="Failed searches" value={failed.length} tone={failed.length ? 'warn' : 'good'} />
        <Stat label="Follow-ups not run" value={notRun.length} />
      </div>

      <Card title="Sub-questions not found in sources">
        {!notFoundSections.length ? <Empty>Every sub-question has cited support.</Empty> : (
          <ul className="space-y-2">
            {notFoundSections.map((s) => (
              <li key={s.index} className="flex items-start gap-3 rounded-md border border-red-400/25 bg-red-400/[0.04] px-3 py-2 text-sm">
                <span className="font-mono text-xs text-red-300">Q{s.index}</span>
                <span className="min-w-0 text-zinc-200">{s.question}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Claims without support">
          {!weak.length ? <Empty>Every checked claim found support.</Empty> : (
            <ul className="space-y-2">
              {weak.map((c, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <Pill status={c.status} />
                  <span className="min-w-0 text-zinc-300">{c.claim}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Searches that failed">
          {!failed.length ? <Empty>No search failed.</Empty> : (
            <ul className="space-y-2">
              {failed.map((f, i) => (
                <li key={i} className="rounded-md border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2">
                  <p className="text-sm text-zinc-200">{f.query}</p>
                  <p className="mt-1 font-mono text-[11px] text-amber-300 [overflow-wrap:anywhere]">{f.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Follow-up queries proposed but not run">
          {!notRun.length ? <Empty>None.</Empty> : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">{notRun.map((g) => <li key={g}>{g}</li>)}</ul>
          )}
        </Card>
        <Card title="Problems the run survived" aside={`${problems.length}`}>
          {!problems.length ? <Empty>None.</Empty> : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto font-mono text-[11px] text-zinc-400">
              {problems.map((p, i) => <li key={i} className="[overflow-wrap:anywhere]">• {p}</li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
