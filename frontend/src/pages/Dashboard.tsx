// Dashboard: totals across every run, the selected run at a glance, and recent runs.

import AgentStrip from '../components/AgentStrip'
import { go } from '../router'
import { useStore } from '../store'
import { Card, Empty, Legend, Pill, StackedBar, STATUS_COLOR, Stat, STOP_REASON, fmtInt, fmtTime, pct } from '../ui'

export default function Dashboard() {
  const { runs, d, maxRounds, selected, select, runId } = useStore()
  const done = runs.filter((r) => r.status === 'complete')
  const claims = runs.reduce(
    (a, r) => ({ verified: a.verified + r.claims.verified, partial: a.partial + r.claims.partial, not_found: a.not_found + r.claims.not_found, unchecked: a.unchecked + r.claims.unchecked }),
    { verified: 0, partial: 0, not_found: 0, unchecked: 0 },
  )
  const totalClaims = claims.verified + claims.partial + claims.not_found + claims.unchecked
  const tokens = runs.reduce((a, r) => a + r.usage.prompt_tokens + r.usage.completion_tokens, 0)
  const sources = runs.reduce((a, r) => a + r.sources, 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Research runs" value={runs.length} sub={`${done.length} complete`} />
        <Stat label="Sources retrieved" value={fmtInt(sources)} sub="across all runs" tone="accent" />
        <Stat label="Claims checked" value={fmtInt(totalClaims)} sub={`${pct(claims.verified, totalClaims)} verified`} tone="good" />
        <Stat label="Contradictions" value={runs.reduce((a, r) => a + r.contradictions, 0)} sub="between sources" tone="warn" />
        <Stat label="LLM tokens" value={fmtInt(tokens)} sub={`${runs.reduce((a, r) => a + r.usage.llm_calls, 0)} calls`} />
      </div>

      <Card title="Selected run" aside={selected ? fmtTime(selected.created_at) : undefined}>
        {!selected ? (
          <Empty>No run yet. Start one from New Research.</Empty>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <p className="min-w-0 flex-1 text-base text-zinc-100">{selected.topic}</p>
              <Pill status={selected.status} />
            </div>
            <AgentStrip d={d} maxRounds={maxRounds} />
            {selected.has_report && (
              <div>
                <StackedBar
                  parts={(['verified', 'partial', 'not_found', 'unchecked'] as const).map((k) => ({ value: selected.claims[k], color: STATUS_COLOR[k], label: k }))}
                />
                <Legend items={(['verified', 'partial', 'not_found', 'unchecked'] as const).map((k) => ({ color: STATUS_COLOR[k], label: k.replace('_', ' '), value: selected.claims[k] }))} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {selected.has_report && <QuickLink to="reports" label="Open report" primary />}
              <QuickLink to="agents" label="Agents" />
              <QuickLink to="claims" label="Claims" />
              <QuickLink to="sources" label="Sources" />
              <QuickLink to="cost" label="Cost" />
            </div>
          </div>
        )}
      </Card>

      <Card title="Recent runs" aside={`${runs.length} total`}>
        {!runs.length ? (
          <Empty>Runs you start appear here, and are kept after a server restart.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="font-mono text-[11px] uppercase text-zinc-400">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-3 font-medium">Topic</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Rounds</th>
                  <th className="py-2 pr-3 font-medium">Sources</th>
                  <th className="py-2 pr-3 font-medium">Verified</th>
                  <th className="py-2 pr-3 font-medium">Stopped because</th>
                  <th className="py-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 10).map((r) => {
                  const total = r.claims.verified + r.claims.partial + r.claims.not_found + r.claims.unchecked
                  return (
                    <tr key={r.run_id} className={`border-b border-white/5 ${r.run_id === runId ? 'bg-accent/5' : ''}`}>
                      <td className="py-2.5 pr-3">
                        <button onClick={() => select(r.run_id)} className="block max-w-[300px] truncate text-left text-zinc-200 hover:text-accent" title={r.topic}>
                          {r.topic}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3"><Pill status={r.status} /></td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{r.rounds}/{r.max_rounds}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{r.sources}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{r.has_report ? `${r.claims.verified}/${total}` : '–'}</td>
                      <td className="py-2.5 pr-3 text-xs text-zinc-400">{r.stop_reason ? STOP_REASON[r.stop_reason] ?? r.stop_reason : '–'}</td>
                      <td className="py-2.5 font-mono text-xs text-zinc-400">{fmtTime(r.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function QuickLink({ to, label, primary }: { to: Parameters<typeof go>[0]; label: string; primary?: boolean }) {
  return (
    <button
      onClick={() => go(to)}
      className={`rounded-md border px-3 py-1.5 font-display text-sm ${primary ? 'border-accent/60 bg-accent/10 text-accent hover:bg-accent hover:text-void' : 'border-white/15 text-zinc-300 hover:border-white/30'}`}
    >
      {label}
    </button>
  )
}
