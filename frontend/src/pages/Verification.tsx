// Verification: how far the report can be trusted. Claim outcomes, the citation
// integrity check (every [S#] must map to a retrieved source), and per-section support.

import { useStore } from '../store'
import { Card, Empty, Legend, NeedsRun, Pill, StackedBar, STATUS_COLOR, Stat, pct } from '../ui'
import { useEffect, useState } from 'react'
import { getSystem } from '../api'

const KEYS = ['verified', 'partial', 'not_found', 'unchecked'] as const

export default function Verification() {
  const { report, busy } = useStore()
  const [chain, setChain] = useState<string[]>([])
  useEffect(() => {
    getSystem().then((s) => setChain(s.llm.verify_chain)).catch(() => undefined)
  }, [])
  if (!report) return <NeedsRun what="Verification" busy={busy} />

  const counts = Object.fromEntries(KEYS.map((k) => [k, report.verification.filter((c) => c.status === k).length])) as Record<(typeof KEYS)[number], number>
  const total = report.verification.length
  const cc = report.citation_check
  const sections = report.sections ?? []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Verified" value={pct(counts.verified, total)} sub={`${counts.verified} of ${total} claims`} tone="good" />
        <Stat label="Partial" value={counts.partial} sub="source discusses it" tone="warn" />
        <Stat label="Not found" value={counts.not_found} sub="no support in source" tone={counts.not_found ? 'bad' : 'normal'} />
        <Stat label="Unchecked" value={counts.unchecked} sub="verifier unavailable / capped" />
      </div>

      <Card title="Claim outcomes">
        <StackedBar height="h-4" parts={KEYS.map((k) => ({ value: counts[k], color: STATUS_COLOR[k], label: k }))} />
        <Legend items={KEYS.map((k) => ({ color: STATUS_COLOR[k], label: k.replace('_', ' '), value: counts[k] }))} />
        {chain.length > 0 && <p className="mt-3 text-xs text-zinc-400">Verifier fallback chain: <span className="font-mono text-zinc-200">{chain.join(' → ')}</span></p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Citation integrity">
          {!cc ? <Empty>Not available for this run.</Empty> : (
            <ul className="divide-y divide-white/5 text-sm">
              <Row label="Inline citations in report" value={cc.citations} />
              <Row label="Distinct sources cited" value={`${cc.unique_cited} of ${cc.sources}`} />
              <Row label="Citations to unknown sources" value={cc.dangling.length ? cc.dangling.join(', ') : '0'} bad={cc.dangling.length > 0} />
              <Row label="Retrieved but not cited" value={cc.uncited_sources} />
            </ul>
          )}
          {cc && <p className="mt-3"><Pill status={cc.dangling.length ? 'not_found' : 'verified'} label={cc.dangling.length ? 'dangling citations found' : 'every citation maps to a real URL'} /></p>}
        </Card>

        <Card title="Support per section">
          {!sections.length ? <Empty>No sections.</Empty> : (
            <ul className="divide-y divide-white/5">
              {sections.map((s) => (
                <li key={s.index} className="flex items-start gap-3 py-2.5">
                  <span className="font-mono text-xs text-accent">Q{s.index}</span>
                  <span className="min-w-0 flex-1 text-sm text-zinc-200">{s.question}</span>
                  <Pill status={s.not_found ? 'not_found' : s.citations ? 'verified' : 'partial'} label={s.not_found ? 'not found' : `${s.citations} cites`} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value, bad }: { label: string; value: string | number; bad?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2">
      <span className="text-zinc-300">{label}</span>
      <span className={`font-mono ${bad ? 'text-red-300' : 'text-zinc-100'}`}>{value}</span>
    </li>
  )
}
