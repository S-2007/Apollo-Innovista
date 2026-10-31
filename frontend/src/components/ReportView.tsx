// The verified report. Markdown is rendered with react-markdown; inside text,
//  - [S3] becomes a link to the source URL, with a hover card (title + snippet)
//  - sentences whose verification is "partial" or "not_found" get a dotted marker
// The download link fetches the exported report.md from the backend.

import { Children, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { reportDownloadUrl, type Claim, type Report, type Source } from '../api'

const MARK: Record<string, string> = {
  partial: 'underline decoration-amber-500 decoration-dotted decoration-2 underline-offset-4',
  not_found: 'underline decoration-red-400 decoration-dotted decoration-2 underline-offset-4',
}

function Citation({ id, source }: { id: string; source?: Source }) {
  if (!source) return <span>[{id}]</span>
  return (
    <span className="group relative inline-block">
      <a href={source.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-700 hover:underline">
        [{id}]
      </a>
      {/* anchored at the right so the card opens leftwards, into the page (no horizontal overflow) */}
      <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-1 hidden w-72 rounded-md border border-zinc-200 bg-white p-2 text-xs font-normal text-zinc-700 shadow-lg group-hover:block">
        <span className="block break-all font-semibold text-zinc-900">{source.title || source.url}</span>
        <span className="mt-1 block text-zinc-600">{source.snippet}</span>
      </span>
    </span>
  )
}

function withCitations(text: string, sources: Map<string, Source>, keyPrefix: string): ReactNode[] {
  return text.split(/(\[S\d+\])/).map((part, i) => {
    const m = part.match(/^\[(S\d+)\]$/)
    return m ? <Citation key={`${keyPrefix}-${i}`} id={m[1]} source={sources.get(m[1])} /> : part
  })
}

/** Split a text node around flagged claims, then turn [S#] tokens into citation links. */
function enhance(text: string, flagged: Claim[], sources: Map<string, Source>): ReactNode[] {
  const ranges = flagged
    .map((c) => ({ start: text.indexOf(c.claim), claim: c }))
    .filter((r) => r.start >= 0)
    .sort((a, b) => a.start - b.start)
  const out: ReactNode[] = []
  let pos = 0
  ranges.forEach(({ start, claim }, i) => {
    if (start < pos) return // overlapping match: keep the first
    out.push(...withCitations(text.slice(pos, start), sources, `t${i}`))
    out.push(
      <span key={`c${i}`} className={MARK[claim.status]} title={`Verification: ${claim.status.replace('_', ' ')}`}>
        {withCitations(claim.claim, sources, `c${i}`)}
      </span>,
    )
    pos = start + claim.claim.length
  })
  out.push(...withCitations(text.slice(pos), sources, 'end'))
  return out
}

export default function ReportView({ report, runId }: { report: Report; runId: string }) {
  const sources = new Map(report.sources.map((s) => [s.id, s]))
  const flagged = report.verification.filter((c) => c.status === 'partial' || c.status === 'not_found')
  const render = (children: ReactNode) =>
    Children.map(children, (child) => (typeof child === 'string' ? enhance(child, flagged, sources) : child))

  return (
    <article>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <a href={reportDownloadUrl(runId)} download className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
          Download report.md
        </a>
        <span className={MARK.partial}>partial support</span>
        <span className={MARK.not_found}>not found in source</span>
        <span>Hover a citation to see its source.</span>
      </div>
      <div className="space-y-3 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p>{render(children)}</p>,
            li: ({ children }) => <li>{render(children)}</li>,
          }}
        >
          {report.markdown}
        </ReactMarkdown>
      </div>
    </article>
  )
}
