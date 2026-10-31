// Final Reports: every run that produced a report (kept across restarts), and the
// selected report rendered with citation chips and a Markdown download.

import ReportView from '../components/ReportView'
import { useStore } from '../store'
import { Card, Empty, NeedsRun, Pill, STOP_REASON, fmtTime } from '../ui'

export default function Reports() {
  const { runs, runId, select, report, busy } = useStore()
  const withReport = runs.filter((r) => r.has_report)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card title="Reports" aside={`${withReport.length}`} className="xl:sticky xl:top-20 xl:self-start">
        {!withReport.length ? <Empty>No reports yet.</Empty> : (
          <ul className="-mx-2 max-h-[70vh] space-y-1 overflow-y-auto">
            {withReport.map((r) => (
              <li key={r.run_id}>
                <button
                  onClick={() => select(r.run_id)}
                  aria-current={r.run_id === runId ? 'true' : undefined}
                  className={`w-full rounded-md px-2 py-2 text-left ${r.run_id === runId ? 'bg-accent/10' : 'hover:bg-white/5'}`}
                >
                  <p className={`line-clamp-2 text-sm ${r.run_id === runId ? 'text-accent' : 'text-zinc-200'}`}>{r.topic}</p>
                  <p className="mt-1 flex items-center gap-2 font-mono text-[11px] text-zinc-500">
                    {fmtTime(r.created_at)} · {r.sources} src · {r.claims.verified} ✓
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="min-w-0">
        {report && runId ? (
          <Card
            aside={<span className="inline-flex items-center gap-2">{report.status && <Pill status={report.status} />}{report.stop_reason && <span>{STOP_REASON[report.stop_reason] ?? report.stop_reason}</span>}</span>}
          >
            <ReportView report={report} runId={runId} />
          </Card>
        ) : (
          <NeedsRun what="The report" busy={busy} />
        )}
      </div>
    </div>
  )
}
