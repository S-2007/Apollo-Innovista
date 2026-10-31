// Source Intelligence: what the report rests on. Per domain and per source: how the
// text was obtained (full page vs search snippet), whether the report cites it, and how
// the claims citing it fared in verification.

import { useState } from 'react'
import type { ClaimStatus } from '../api'
import { useStore } from '../store'
import { Card, NeedsRun, Pill, StackedBar, STATUS_COLOR, Stat, hostOf, pct } from '../ui'

const KEYS: ClaimStatus[] = ['verified', 'partial', 'not_found', 'unchecked']

export default function Sources() {
  const { report, busy } = useStore()
  const [domain, setDomain] = useState<string | null>(null)
  if (!report) return <NeedsRun what="Source intelligence" busy={busy} />

  const sources = report.sources
  const fullText = sources.filter((s) => s.extracted_by && s.extracted_by !== 'snippet only').length
  const cited = sources.filter((s) => s.cited).length
  const domains = new Map<string, { n: number; cited: number; claims: Record<ClaimStatus, number> }>()
  for (const s of sources) {
    const h = hostOf(s.url)
    const row = domains.get(h) ?? { n: 0, cited: 0, claims: { verified: 0, partial: 0, not_found: 0, unchecked: 0 } }
    row.n += 1
    row.cited += s.cited ? 1 : 0
    KEYS.forEach((k) => (row.claims[k] += s.claims?.[k] ?? 0))
    domains.set(h, row)
  }
  const shown = domain ? sources.filter((s) => hostOf(s.url) === domain) : sources

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sources" value={sources.length} tone="accent" />
        <Stat label="Domains" value={domains.size} sub="distinct sites" />
        <Stat label="Full text read" value={pct(fullText, sources.length)} sub={`${sources.length - fullText} snippet only`} />
        <Stat label="Cited in report" value={pct(cited, sources.length)} sub={`${cited} of ${sources.length}`} tone="good" />
      </div>

      <Card title="By domain" aside={domain ? <button onClick={() => setDomain(null)} className="text-accent hover:underline">clear filter</button> : 'click to filter'}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="font-mono text-[11px] uppercase text-zinc-400">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 font-medium">Domain</th>
                <th className="py-2 pr-3 font-medium">Sources</th>
                <th className="py-2 pr-3 font-medium">Cited</th>
                <th className="w-56 py-2 font-medium">Claims citing it</th>
              </tr>
            </thead>
            <tbody>
              {[...domains.entries()].sort((a, b) => b[1].n - a[1].n).map(([h, r]) => (
                <tr key={h} className={`border-b border-white/5 ${domain === h ? 'bg-accent/5' : ''}`}>
                  <td className="py-2 pr-3"><button onClick={() => setDomain(domain === h ? null : h)} className="font-mono text-xs text-zinc-200 hover:text-accent">{h}</button></td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.n}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.cited}</td>
                  <td className="py-2">
                    {KEYS.some((k) => r.claims[k]) ? <StackedBar height="h-1.5" parts={KEYS.map((k) => ({ value: r.claims[k], color: STATUS_COLOR[k], label: k }))} /> : <span className="text-xs text-zinc-500">no claims</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={domain ? `Sources · ${domain}` : 'All sources'}>
        <ul className="divide-y divide-white/5">
          {shown.map((s) => (
            <li key={s.id} className="grid gap-2 py-3 md:grid-cols-[3rem_minmax(0,1fr)_auto]">
              <span className="font-mono text-xs text-accent">{s.id}</span>
              <div className="min-w-0">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-sm text-zinc-100 hover:text-accent">{s.title || s.url}</a>
                <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{s.url}</p>
                {s.question && <p className="mt-1 text-xs text-zinc-400">For Q{s.section}: {s.question}</p>}
              </div>
              <div className="flex flex-wrap content-start gap-1.5 md:justify-end">
                <Pill status={s.extracted_by === 'snippet only' ? 'partial' : 'complete'} label={s.extracted_by ?? 'unknown'} />
                <Pill status={s.cited ? 'verified' : 'unchecked'} label={s.cited ? 'cited' : 'not cited'} />
                {KEYS.filter((k) => s.claims?.[k]).map((k) => <Pill key={k} status={k} label={`${s.claims?.[k]} ${k.replace('_', ' ')}`} />)}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
