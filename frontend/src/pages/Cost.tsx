// Cost & Execution: the selected run's usage meter: LLM calls and tokens per model,
// web searches, time per stage, and the full call log. A dollar cost is shown only when
// PRICE_* values are set in .env; otherwise tokens are the honest unit.

import { useStore } from '../store'
import { Card, Empty, Meter, Pill, Stat, fmtInt, fmtMs, fmtSec } from '../ui'

const STAGE_COLOR: Record<string, string> = {
  planning: 'bg-accent', searching: 'bg-emerald-400', reviewing: 'bg-violet-400', 'waiting for you': 'bg-zinc-500',
  writing: 'bg-sky-400', verifying: 'bg-amber-400', finishing: 'bg-pink-400',
}

export default function Cost() {
  const { metrics, runId } = useStore()
  if (!runId) return <Card><Empty>Start a run to see what it costs.</Empty></Card>
  if (!metrics) return <Card><Empty>Loading usage…</Empty></Card>

  const s = metrics.summary
  const stageTotal = metrics.stages.reduce((a, x) => a + x.ms, 0)
  const llmRows = metrics.by_model.filter((r) => r.name !== 'web search')
  const maxCalls = Math.max(0, ...llmRows.map((r) => r.calls))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Wall time" value={fmtMs(metrics.wall_ms)} sub="start to finish" />
        <Stat label="LLM calls" value={s.llm_calls} sub={s.llm_failed ? `${s.llm_failed} failed / retried` : 'none failed'} tone={s.llm_failed ? 'warn' : 'normal'} />
        <Stat label="Input tokens" value={fmtInt(s.prompt_tokens)} tone="accent" />
        <Stat label="Output tokens" value={fmtInt(s.completion_tokens)} tone="accent" />
        <Stat label="Web searches" value={s.searches} sub={s.searches_failed ? `${s.searches_failed} failed` : `${fmtSec(s.search_seconds)} total`} tone={s.searches_failed ? 'warn' : 'normal'} />
        <Stat label="Est. cost" value={metrics.cost_usd === null ? '–' : `$${metrics.cost_usd.toFixed(4)}`} sub={metrics.cost_usd === null ? 'set PRICE_* in .env' : 'from .env prices'} />
      </div>

      <Card title="Time per stage" aside="from event timestamps">
        {!metrics.stages.length ? <Empty>No stages yet.</Empty> : (
          <>
            <div className="flex h-5 w-full overflow-hidden rounded-md bg-white/5">
              {metrics.stages.map((st, i) => st.ms > 0 && (
                <div key={i} className={STAGE_COLOR[st.stage] ?? 'bg-zinc-400'} style={{ width: `${(st.ms / Math.max(1, stageTotal)) * 100}%` }} title={`${st.stage}: ${fmtMs(st.ms)}`} />
              ))}
            </div>
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {metrics.stages.map((st, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-zinc-300"><span className={`h-2 w-2 rounded-sm ${STAGE_COLOR[st.stage] ?? 'bg-zinc-400'}`} />{st.stage}</span>
                  <span className="font-mono text-xs text-zinc-200">{fmtMs(st.ms)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="LLM usage by model">
        {!llmRows.length ? <Empty>No LLM calls recorded for this run.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="font-mono text-[11px] uppercase text-zinc-400">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-3 font-medium">Provider : model</th>
                  <th className="w-40 py-2 pr-3 font-medium">Calls</th>
                  <th className="py-2 pr-3 font-medium">Input</th>
                  <th className="py-2 pr-3 font-medium">Output</th>
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {llmRows.map((r) => (
                  <tr key={r.name} className="border-b border-white/5">
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-200">{r.name}</td>
                    <td className="py-2 pr-3"><div className="flex items-center gap-2"><span className="w-10 font-mono text-xs">{r.calls}</span><div className="flex-1"><Meter value={r.calls} max={maxCalls} /></div></div></td>
                    <td className="py-2 pr-3 font-mono text-xs">{fmtInt(r.prompt_tokens)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{fmtInt(r.completion_tokens)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{fmtSec(r.seconds)}</td>
                    <td className="py-2 font-mono text-xs">{r.cost_usd === undefined ? '–' : `$${r.cost_usd.toFixed(4)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Call log" aside={`${metrics.calls.length} calls`}>
        {!metrics.calls.length ? <Empty>No calls yet.</Empty> : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-void font-mono text-[11px] uppercase text-zinc-400">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Node</th>
                  <th className="py-2 pr-3 font-medium">Call</th>
                  <th className="py-2 pr-3 font-medium">Tokens / results</th>
                  <th className="py-2 pr-3 font-medium">Took</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {metrics.calls.map((c, i) => (
                  <tr key={i} className="border-b border-white/5 align-top">
                    <td className="py-1.5 pr-3 text-zinc-500">{new Date(c.ts).toLocaleTimeString('en-IN')}</td>
                    <td className="py-1.5 pr-3 text-zinc-300">{c.node || '–'}</td>
                    <td className="max-w-[280px] truncate py-1.5 pr-3 text-zinc-200" title={c.kind === 'search' ? c.query : c.model}>
                      {c.kind === 'search' ? `search · ${c.query ?? ''}` : `${c.provider}:${c.model}`}
                    </td>
                    <td className="py-1.5 pr-3 text-zinc-300">{c.kind === 'search' ? `${c.results ?? 0} results` : `${fmtInt(c.prompt_tokens ?? 0)} → ${fmtInt(c.completion_tokens ?? 0)}`}</td>
                    <td className="py-1.5 pr-3 text-zinc-300">{fmtSec(c.seconds)}</td>
                    <td className="py-1.5" title={c.error}>{c.ok ? <Pill status="verified" label="ok" /> : <Pill status="not_found" label="failed" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
