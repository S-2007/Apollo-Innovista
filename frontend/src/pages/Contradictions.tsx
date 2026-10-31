// Contradictions: source pairs Hermes found to disagree, side by side with each source's
// snippet, the disputed claim as Hermes stated it, and the interactive map. The backend does
// not classify conflicts, so every conflict is "Unclassified" and the five classes are
// listed as pending. A reader's preferred source is saved in this browser only.

import { useState } from 'react'
import type { Source } from '../api'
import { CONFLICT_CHECK_TEXT, conflictCheck } from '../insights'
import { useStore } from '../store'
import { Empty, NeedsRun, PageHeader, Panel, Pill, Stat, Unavailable, btn, hostOf } from '../ui'

const CLASSES = ['Direct Contradiction', 'Different Methodology', 'Outdated Information', 'Different Context', 'Unresolved Disagreement'] as const
const PREF_KEY = 'apollo.sourcePreference'

function loadPrefs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export default function Contradictions() {
  const { report, busy, runId } = useStore()
  const [prefs, setPrefs] = useState<Record<string, string>>(loadPrefs)
  if (!report || !runId) return <><PageHeader kicker="06 · Contradictions" title="Source disagreement" /><NeedsRun what="Contradictions" busy={busy} /></>

  const list = report.contradictions ?? []
  const byId = new Map(report.sources.map((s) => [s.id, s]))
  const involved = new Set(list.flatMap((c) => [c.source_a, c.source_b]))
  const check = conflictCheck(report.review_health)
  const h = report.review_health
  const prefer = (key: string, id: string | null) => {
    const next = { ...prefs }
    if (id) next[key] = id
    else delete next[key]
    setPrefs(next)
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next))
    } catch {
      /* private mode: preference lasts for this page only */
    }
  }

  return (
    <div>
      <PageHeader kicker="06 · Contradictions" title="Source disagreement" />
      {(check === 'not_checked' || check === 'partial') && (
        <div role="alert" className={`mb-5 border px-4 py-3 ${check === 'not_checked' ? 'border-err/60 bg-err/10' : 'border-warn/70 bg-warn/15'}`}>
          <p className={`font-display text-sm font-semibold ${check === 'not_checked' ? 'text-err-ink' : 'text-warn-ink'}`}>
            {check === 'not_checked' ? 'Contradiction check did not run' : 'Contradiction check incomplete'}
          </p>
          <p className="mt-0.5 text-sm text-ink">{CONFLICT_CHECK_TEXT[check]} {h ? `(${h.reviews_failed} of ${h.reviews} Hermes review${h.reviews === 1 ? '' : 's'} failed.)` : ''} Re-run the research to check again.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-3 [&>*]:border-0">
        <Stat label="Conflicts" value={check === 'not_checked' ? 'Not checked' : list.length} sub={h ? `${h.reviews - h.reviews_failed} of ${h.reviews} reviews ran` : undefined} tone={check === 'not_checked' ? 'bad' : list.length ? 'warn' : 'good'} />
        <Stat label="Sources involved" value={involved.size} sub={`of ${report.sources.length}`} />
        <Stat label="Unresolved" value={list.filter((_, i) => !prefs[`${runId}:${i}`]).length} sub="no preferred source chosen" />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel label="Conflicting-source detection" title="Side-by-side comparison">
          {!list.length ? <Empty>{check === 'not_checked' ? 'Unknown: the sources were never compared.' : `No conflicts found in sources. ${CONFLICT_CHECK_TEXT[check]}`}</Empty> : (
            <ul className="space-y-4">
              {list.map((c, i) => {
                const key = `${runId}:${i}`
                const chosen = prefs[key]
                return (
                  <li key={i} className="border border-warn/70">
                    <div className="flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-2">
                      <span className="font-mono text-[11px] text-warn-ink">CONFLICT {i + 1}</span>
                      <Pill status="unavailable" label="unclassified" />
                      {chosen ? <Pill status="verified" label={`you prefer ${chosen}`} /> : <Pill status="warn" label="unresolved" />}
                    </div>
                    <div className="p-3">
                      <p className="label">Disputed point (Hermes' explanation)</p>
                      <p className="mt-1 text-sm text-ink">{c.claim}</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <Side id={c.source_a} s={byId.get(c.source_a)} chosen={chosen === c.source_a} onPrefer={() => prefer(key, chosen === c.source_a ? null : c.source_a)} />
                        <Side id={c.source_b} s={byId.get(c.source_b)} chosen={chosen === c.source_b} onPrefer={() => prefer(key, chosen === c.source_b ? null : c.source_b)} />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <div className="min-w-0 space-y-5">
          <Panel label="Classification" title="Conflict types">
            <ul className="divide-y divide-hair text-sm">
              {CLASSES.map((k) => <li key={k} className="flex items-center justify-between py-2"><span className="text-ink">{k}</span><span className="font-mono text-xs text-muted">n/a</span></li>)}
            </ul>
            <div className="mt-3">
              <Unavailable what="Automatic conflict classification" need="a type field on each contradiction (Hermes returns source_a, source_b and an explanation only)." />
            </div>
          </Panel>
          <Panel label="Manual source preference" title="How preferences work">
            <p className="text-xs text-muted">Choosing a preferred source records your judgement in this browser only. It is not sent to the backend and does not change the report.</p>
          </Panel>
        </div>
      </div>

      {report.contradictions_html_path && (
        <div className="mt-5">
          <Panel label="Source relationships" title="Contradiction map" aside="drag nodes · hover edges" pad={false}>
            <iframe title="Contradiction map" src={report.contradictions_html_path} className="h-[520px] w-full bg-white" />
          </Panel>
        </div>
      )}
    </div>
  )
}

function Side({ id, s, chosen, onPrefer }: { id: string; s?: Source; chosen: boolean; onPrefer: () => void }) {
  return (
    <div className={`flex min-w-0 flex-col border p-3 ${chosen ? 'border-ok' : 'border-line'}`}>
      <p className="font-mono text-[11px] text-accent-ink">{id}{s ? ` · ${hostOf(s.url)}` : ''}</p>
      {s ? (
        <>
          <a href={s.url} target="_blank" rel="noreferrer" className="mt-0.5 text-sm text-ink underline decoration-line underline-offset-2 hover:decoration-ink">{s.title || s.url}</a>
          {s.snippet && <p className="mt-1.5 text-xs leading-relaxed text-muted">{s.snippet}</p>}
        </>
      ) : <p className="mt-1 text-sm text-muted">Source not in this run.</p>}
      <button onClick={onPrefer} aria-pressed={chosen} className={`${btn.secondary} mt-auto self-start ${chosen ? 'border-ok text-ok-ink' : ''}`} style={{ marginTop: 12 }}>
        {chosen ? '✓ Preferred' : 'Prefer this source'}
      </button>
    </div>
  )
}
