// Analytics: comparisons across all finished runs: duration, sources, verification
// outcome, search reliability, token use, and why each run stopped.

import type { ReactNode } from 'react'
import { useStore } from '../store'
import { Card, Empty, Legend, Meter, StackedBar, STATUS_COLOR, Stat, STOP_REASON, fmtInt, fmtMs, pct } from '../ui'

const KEYS = ['verified', 'partial', 'not_found', 'unchecked'] as const

export default function Analytics() {
  const { runs, select } = useStore()
  const done = runs.filter((r) => r.finished_at)
  if (!done.length) return <Card><Empty>Analytics compare finished runs. Finish at least one run to see them.</Empty></Card>

  const dur = (r: (typeof done)[number]) => (r.finished_at ?? r.created_at) - r.created_at
  const total = (r: (typeof done)[number]) => KEYS.reduce((a, k) => a + r.claims[k], 0)
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
  const allClaims = Object.fromEntries(KEYS.map((k) => [k, sum(done, (r) => r.claims[k])])) as Record<(typeof KEYS)[number], number>
  const claimTotal = KEYS.reduce((a, k) => a + allClaims[k], 0)
  const searches = sum(done, (r) => r.usage.searches)
  const searchFails = sum(done, (r) => r.usage.searches_failed)
  const maxDur = Math.max(...done.map(dur))
  const maxSources = Math.max(...done.map((r) => r.sources))
  const maxTokens = Math.max(...done.map((r) => r.usage.prompt_tokens + r.usage.completion_tokens))
  const stops = new Map<string, number>()
  done.forEach((r) => r.stop_reason && stops.set(r.stop_reason, (stops.get(r.stop_reason) ?? 0) + 1))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Finished runs" value={done.length} sub={`${done.filter((r) => r.status === 'complete').length} complete`} />
        <Stat label="Avg duration" value={fmtMs(sum(done, dur) / done.length)} sub="start to report" />
        <Stat label="Verification rate" value={pct(allClaims.verified, claimTotal)} sub={`${allClaims.verified} of ${claimTotal} claims`} tone="good" />
        <Stat label="Search success" value={pct(searches - searchFails, searches)} sub={`${searchFails} failed of ${searches}`} tone={searchFails ? 'warn' : 'normal'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Claim outcomes, all runs">
          <StackedBar height="h-4" parts={KEYS.map((k) => ({ value: allClaims[k], color: STATUS_COLOR[k], label: k }))} />
          <Legend items={KEYS.map((k) => ({ color: STATUS_COLOR[k], label: k.replace('_', ' '), value: allClaims[k] }))} />
        </Card>
        <Card title="Why runs stopped">
          <ul className="space-y-2">
            {[...stops.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <li key={k} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                <div>
                  <p className="text-zinc-300">{STOP_REASON[k] ?? k}</p>
                  <Meter value={n} max={done.length} />
                </div>
                <span className="text-right font-mono text-xs text-zinc-200">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Per run" aside="click a topic to select the run">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="font-mono text-[11px] uppercase text-zinc-400">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 font-medium">Topic</th>
                <th className="w-40 py-2 pr-3 font-medium">Duration</th>
                <th className="w-36 py-2 pr-3 font-medium">Sources</th>
                <th className="w-48 py-2 pr-3 font-medium">Claims</th>
                <th className="w-40 py-2 pr-3 font-medium">Tokens</th>
                <th className="w-20 py-2 font-medium">Searches</th>
              </tr>
            </thead>
            <tbody>
              {done.map((r) => {
                const tokens = r.usage.prompt_tokens + r.usage.completion_tokens
                return (
                  <tr key={r.run_id} className="border-b border-white/5 align-middle">
                    <td className="py-2.5 pr-3">
                      <button onClick={() => select(r.run_id)} className="block max-w-[260px] truncate text-left text-zinc-200 hover:text-accent" title={r.topic}>{r.topic}</button>
                    </td>
                    <td className="py-2.5 pr-3"><Cell text={fmtMs(dur(r))}><Meter value={dur(r)} max={maxDur} /></Cell></td>
                    <td className="py-2.5 pr-3"><Cell text={String(r.sources)}><Meter value={r.sources} max={maxSources} color="bg-emerald-400" /></Cell></td>
                    <td className="py-2.5 pr-3">
                      {r.has_report ? (
                        <Cell text={`${r.claims.verified}/${total(r)}`}><StackedBar height="h-1.5" parts={KEYS.map((k) => ({ value: r.claims[k], color: STATUS_COLOR[k], label: k }))} /></Cell>
                      ) : <span className="text-xs text-zinc-500">no report</span>}
                    </td>
                    <td className="py-2.5 pr-3"><Cell text={fmtInt(tokens)}><Meter value={tokens} max={maxTokens} color="bg-violet-400" /></Cell></td>
                    <td className="py-2.5 font-mono text-xs">{r.usage.searches}{r.usage.searches_failed ? <span className="text-amber-300"> · {r.usage.searches_failed}✕</span> : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-500">Token and search counts exist only for runs made after usage metering was added; older runs show 0.</p>
      </Card>
    </div>
  )
}

function Cell({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 font-mono text-xs text-zinc-200">{text}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
