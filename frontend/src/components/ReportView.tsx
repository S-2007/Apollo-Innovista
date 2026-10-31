// The verified report, set like a research brief. Markdown is rendered with
// react-markdown; inside the text,
//  - [S3] becomes a citation chip linking to the source, with a hover card (title + snippet)
//  - sentences whose verification is "partial" or "not_found" get a dotted underline
// The header numbers come from the run itself; the download link fetches report.md.

import { Download, ExternalLink } from 'lucide-react'
import { Children, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { reportDownloadUrl, type Claim, type Report, type Source } from '../api'

const MARK: Record<string, string> = {
  partial: 'underline decoration-amber-500 decoration-dotted decoration-2 underline-offset-[5px]',
  not_found: 'underline decoration-red-400 decoration-dotted decoration-2 underline-offset-[5px]',
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Citation({ id, source }: { id: string; source?: Source }) {
  if (!source) return <span className="font-mono text-xs">[{id}]</span>
  return (
    <span className="group relative inline-block align-baseline">
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="mx-0.5 rounded-md bg-apollo-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-apollo no-underline hover:bg-apollo hover:text-white focus-visible:bg-apollo focus-visible:text-white"
      >
        {id}
      </a>
      {/* anchored at the right so the card opens leftwards, into the page (no horizontal overflow) */}
      <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden w-80 rounded-xl border border-slate-200 bg-white p-3 text-left font-sans text-xs font-normal leading-relaxed text-slate-600 shadow-lift group-focus-within:block group-hover:block">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
          {id} · {host(source.url)} <ExternalLink className="h-3 w-3" />
        </span>
        <span className="mt-1 block break-words text-[13px] font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">
          {source.title || source.url}
        </span>
        {source.snippet && <span className="mt-1.5 block">{source.snippet}</span>}
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

/** Split a text node around flagged claims, then turn [S#] tokens into citation chips. */
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

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}

export default function ReportView({ report, runId, rounds }: { report: Report; runId: string; rounds?: number }) {
  const sources = new Map(report.sources.map((s) => [s.id, s]))
  const flagged = report.verification.filter((c) => c.status === 'partial' || c.status === 'not_found')
  const verified = report.verification.filter((c) => c.status === 'verified').length
  const render = (children: ReactNode) =>
    Children.map(children, (child) => (typeof child === 'string' ? enhance(child, flagged, sources) : child))

  // The report body starts with "# <topic>"; the title is shown in the header instead.
  const body = report.markdown.replace(/^# .*\n+/, '')

  return (
    <article className="mx-auto max-w-[760px]">
      <header className="border-b border-slate-200 pb-6">
        <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.01em] text-slate-900 [text-wrap:balance] sm:text-[32px]">
          {report.topic}
        </h1>
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat value={rounds ?? '–'} label="Research rounds" />
          <Stat value={report.sources.length} label="Sources read" />
          <Stat value={report.references.length} label="Sources cited" />
          <Stat value={`${verified} / ${report.verification.length}`} label="Claims verified" />
        </dl>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <a
            href={reportDownloadUrl(runId)}
            download
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            <Download className="h-4 w-4" /> Download report.md
          </a>
          <span className={MARK.partial}>partial support</span>
          <span className={MARK.not_found}>not found in source</span>
          <span>Hover or focus a citation to see its source.</span>
        </div>
      </header>

      <div className="mt-6 font-serif text-[17px] leading-[1.75] text-slate-800 [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:font-sans [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:text-slate-900 [&_h2]:[text-wrap:balance] [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-4 [&_p]:max-w-[68ch]">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p>{render(children)}</p>,
            li: ({ children }) => <li>{render(children)}</li>,
          }}
        >
          {body}
        </ReactMarkdown>
      </div>
    </article>
  )
}
