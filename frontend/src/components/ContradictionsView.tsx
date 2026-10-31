// Hermes' contradictions: each disputed claim with the two sources, then the
// pyvis map in an iframe, or a clear message when the sources do not conflict.

import { ShieldCheck } from 'lucide-react'
import type { Report } from '../api'

export default function ContradictionsView({ report }: { report: Report }) {
  if (!report.contradictions_html_path) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-hermes-soft text-hermes">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <p className="font-medium text-slate-800">No conflicts found in sources</p>
        <p className="max-w-sm text-sm text-slate-500">Hermes compared the sources it reviewed and found no two that disagree on the same claim.</p>
      </div>
    )
  }
  return (
    <div className="space-y-5">
      <ul className="space-y-2">
        {report.contradictions.map((c, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-2 rounded-xl bg-hermes-soft/60 px-3.5 py-2.5 text-sm">
            <span className="font-mono text-xs font-medium text-hermes">
              {c.source_a} ↔ {c.source_b}
            </span>
            <span className="min-w-0 flex-1 text-slate-800">{c.claim}</span>
          </li>
        ))}
      </ul>
      <iframe
        title="Contradiction map"
        src={report.contradictions_html_path}
        className="h-[560px] w-full rounded-xl border border-slate-200"
      />
    </div>
  )
}
