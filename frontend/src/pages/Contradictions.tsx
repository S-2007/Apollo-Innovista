// Contradictions: pairs of retrieved sources that disagree, with the disputed claim and
// both sources side by side, plus the interactive contradiction map.

import { useStore } from '../store'
import { Card, Empty, NeedsRun, Stat, hostOf } from '../ui'

export default function Contradictions() {
  const { report, busy } = useStore()
  if (!report) return <NeedsRun what="Contradictions" busy={busy} />
  const list = report.contradictions ?? []
  const byId = new Map(report.sources.map((s) => [s.id, s]))
  const involved = new Set(list.flatMap((c) => [c.source_a, c.source_b]))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Conflicts" value={list.length} tone={list.length ? 'warn' : 'good'} />
        <Stat label="Sources involved" value={involved.size} sub={`of ${report.sources.length}`} />
        <Stat label="Agreement" value={report.sources.length ? `${Math.round(((report.sources.length - involved.size) / report.sources.length) * 100)}%` : '–'} sub="sources in no conflict" />
      </div>

      <Card title="Conflicting claims">
        {!list.length ? (
          <Empty>No conflicts found in sources.</Empty>
        ) : (
          <ul className="space-y-3">
            {list.map((c, i) => (
              <li key={i} className="rounded-md border border-amber-400/25 bg-amber-400/[0.04] p-3">
                <p className="text-sm text-zinc-100">{c.claim}</p>
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
                  <SourceBox id={c.source_a} title={byId.get(c.source_a)?.title} url={byId.get(c.source_a)?.url} />
                  <span className="self-center text-center font-mono text-xs text-amber-300">vs</span>
                  <SourceBox id={c.source_b} title={byId.get(c.source_b)?.title} url={byId.get(c.source_b)?.url} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {report.contradictions_html_path && (
        <Card title="Contradiction map" aside="drag nodes · hover edges">
          <iframe title="Contradiction map" src={report.contradictions_html_path} className="h-[560px] w-full rounded-md border border-white/10 bg-white" />
        </Card>
      )}
    </div>
  )
}

function SourceBox({ id, title, url }: { id: string; title?: string; url?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/30 px-3 py-2">
      <p className="font-mono text-[11px] text-accent">{id}{url ? ` · ${hostOf(url)}` : ''}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-sm text-zinc-200 hover:text-accent" title={title}>{title || url}</a>
      ) : (
        <p className="mt-0.5 text-sm text-zinc-400">source not in this run</p>
      )}
    </div>
  )
}
