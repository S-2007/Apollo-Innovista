// Hermes' contradictions: the pyvis map in an iframe, plus a plain list of the
// disputed claims, or a clear message when the sources do not conflict.

import type { Report } from '../api'

export default function ContradictionsView({ report }: { report: Report }) {
  if (!report.contradictions_html_path) {
    return <p className="py-6 text-sm text-zinc-600">No conflicts found in sources.</p>
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-sm">
        {report.contradictions.map((c, i) => (
          <li key={i}>
            <span className="font-medium">{c.source_a} vs {c.source_b}:</span> {c.claim}
          </li>
        ))}
      </ul>
      <iframe
        title="Contradiction map"
        src={report.contradictions_html_path}
        className="h-[560px] w-full rounded-md border border-zinc-200"
      />
    </div>
  )
}
