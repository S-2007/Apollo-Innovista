// Research Gaps: "What APOLLO couldn't verify", built only from the run's own records:
// not-found sections, unsupported / unchecked / partial claims, failed searches, pages that
// could not be read (and why), contradictions, and follow-up queries that never ran.

import type { ReactNode } from 'react'
import { isKnown } from '../api'
import { ERROR_LABEL, classifyErrors, type ErrorKind } from '../insights'
import { useStore } from '../store'
import { NeedsRun, PageHeader, Panel, Pill, Stat, Unavailable, hostOf } from '../ui'

const ACCESS: ErrorKind[] = ['blocked', 'fetch_failed', 'non_html', 'no_main_text', 'no_text']

export default function Gaps() {
  const { report, busy, events } = useStore()
  if (!report) return <><PageHeader kicker="09 · Research gaps" title="Uncertainty & limitations" /><NeedsRun what="Research gaps" busy={busy} /></>

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
  const notFoundClaims = report.verification.filter((c) => c.status === 'not_found')
  const unchecked = report.verification.filter((c) => c.status === 'unchecked')
  const partial = report.verification.filter((c) => c.status === 'partial')
  const errs = classifyErrors(report.errors)
  const access = ACCESS.flatMap((k) => (errs[k] ?? []).map((e) => ({ ...e, kind: k })))
  const snippetOnly = report.sources.filter((s) => s.extracted_by === 'snippet only')
  const disputes = report.contradictions ?? []

  return (
    <div>
      <PageHeader kicker="09 · Research gaps" title="Uncertainty & limitations" />

      <section aria-labelledby="couldnt" className="border-2 border-ink bg-surface">
        <header className="border-b border-ink bg-ink px-5 py-3">
          <h2 id="couldnt" className="font-display text-lg font-bold tracking-[0.12em] text-white">WHAT APOLLO COULDN'T VERIFY</h2>
          <p className="text-xs text-[#c9ced6]">Everything below comes from this run's own records. Nothing is hidden behind a generic error.</p>
        </header>
        <div className="grid gap-px bg-hair md:grid-cols-2 xl:grid-cols-3">
          <Block n="1" title="Could not be found" count={notFoundSections.length + notFoundClaims.length}>
            {notFoundSections.map((s) => <Item key={`s${s.index}`} tag={`Q${s.index}`}>{s.question} <em className="text-muted">(section says "not found in sources")</em></Item>)}
            {notFoundClaims.map((c, i) => <Item key={`c${i}`} tag="claim">{c.claim}</Item>)}
          </Block>
          <Block n="2" title="Could not be accessed" count={access.length + snippetOnly.length}>
            {access.map((e, i) => <Item key={i} tag={e.kind === 'blocked' ? 'blocked' : e.kind === 'non_html' ? 'PDF' : e.kind === 'no_main_text' ? 'JS?' : 'fetch'}>{e.url ? hostOf(e.url) : ''} · {ERROR_LABEL[e.kind]}</Item>)}
            {snippetOnly.map((s) => <Item key={s.id} tag={s.id}>{hostOf(s.url)}: only the search snippet was available</Item>)}
          </Block>
          <Block n="3" title="Could not be verified" count={unchecked.length + partial.length}>
            {unchecked.map((c, i) => <Item key={`u${i}`} tag="unchecked">{c.claim}</Item>)}
            {partial.map((c, i) => <Item key={`p${i}`} tag="partial">{c.claim}</Item>)}
          </Block>
          <Block n="4" title="Remains disputed" count={disputes.length}>
            {disputes.map((c, i) => <Item key={i} tag={`${c.source_a}↔${c.source_b}`}>{c.claim}</Item>)}
          </Block>
          <Block n="5" title="Evidence still needed" count={failed.length + notRun.length}>
            {failed.map((f, i) => <Item key={`f${i}`} tag="search failed">Re-run: {f.query}</Item>)}
            {notRun.map((g) => <Item key={g} tag="not run">Search: {g}</Item>)}
            {notFoundSections.map((s) => <Item key={`n${s.index}`} tag={`Q${s.index}`}>Find a primary source for this sub-question</Item>)}
          </Block>
          <Block n="6" title="Not checked by this system" count={null}>
            <Item tag="n/a">False premises and nonexistent subjects are not detected; the planner takes the question as asked.</Item>
            <Item tag="n/a">Scanned PDFs are not OCR'd; non-HTML pages are skipped.</Item>
          </Block>
        </div>
      </section>

      <div className="mt-5 grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4 [&>*]:border-0">
        <Stat label="Unanswered sub-questions" value={notFoundSections.length} tone={notFoundSections.length ? 'bad' : 'good'} />
        <Stat label="Unsupported claims" value={notFoundClaims.length} sub={`${unchecked.length} unchecked · ${partial.length} partial`} tone="warn" />
        <Stat label="Pages not read in full" value={snippetOnly.length + (errs.blocked?.length ?? 0)} sub={`${errs.blocked?.length ?? 0} blocked / paywalled`} />
        <Stat label="Failed searches" value={failed.length} tone={failed.length ? 'warn' : 'good'} sub="search-index limits" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel label="Research limitations" title="Non-fatal problems the run recorded" aside={`${report.errors?.length ?? 0}`}>
          {!(report.errors ?? []).length ? <p className="text-sm text-muted">None recorded.</p> : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {(Object.keys(errs) as ErrorKind[]).map((k) => (
                <li key={k}>
                  <details>
                    <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink"><span>{ERROR_LABEL[k]}</span><span className="font-mono text-xs">{errs[k].length}</span></summary>
                    <ul className="mt-1 space-y-1 pl-3 font-mono text-[11px] text-muted">{errs[k].map((e, i) => <li key={i} className="[overflow-wrap:anywhere]">• {e.text}</li>)}</ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel label="Recommendations" title="How to close the gaps">
          <ul className="space-y-2 text-sm text-ink">
            {failed.length > 0 && <li>• Re-run with the failed queries; a search outage, not missing evidence, may explain them.</li>}
            {notRun.length > 0 && <li>• Use Deep depth or approve follow-up queries so Hermes' {notRun.length} proposed searches run.</li>}
            {snippetOnly.length > 0 && <li>• {snippetOnly.length} sources were judged from snippets only; open them to confirm the cited passages.</li>}
            {unchecked.length > 0 && <li>• {unchecked.length} claims are unchecked (verifier quota/cap). Re-run when quota resets.</li>}
            {notFoundSections.length > 0 && <li>• Look for primary sources (government statistics, peer-reviewed studies) for the unanswered sub-questions.</li>}
            {!failed.length && !notRun.length && !snippetOnly.length && !unchecked.length && !notFoundSections.length && <li className="text-muted">No specific follow-up suggested by this run's records.</li>}
          </ul>
          <div className="mt-4"><Unavailable what="Paywall vs. login vs. bot-block distinction" need="HTTP response details beyond the status code; 401/402/403/451 are grouped." /></div>
        </Panel>
      </div>
    </div>
  )
}

function Block({ n, title, count, children }: { n: string; title: string; count: number | null; children: ReactNode }) {
  return (
    <div className="bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold"><span className="mr-1.5 font-mono text-xs text-muted">{n}</span>{title}</h3>
        {count !== null && <Pill status={count ? 'warn' : 'done'} label={count ? `${count}` : 'none'} />}
      </div>
      <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-[13px] text-ink">{count === 0 ? <li className="text-muted">Nothing recorded.</li> : children}</ul>
    </div>
  )
}

function Item({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
      <span className="mt-[1px] font-mono text-[10px] uppercase text-muted">[{tag}]</span>
      <span className="[overflow-wrap:anywhere]">{children}</span>
    </li>
  )
}
