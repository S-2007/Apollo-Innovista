// Every source Athena collected: id, title and site (opens in a new tab), the
// sub-question it was found for, and how the claims citing it were verified.

import { ExternalLink } from 'lucide-react'
import type { ClaimStatus, Source } from '../api'

export const BADGE: Record<ClaimStatus, string> = {
  verified: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  partial: 'bg-amber-50 text-amber-800 ring-amber-200',
  not_found: 'bg-red-50 text-red-800 ring-red-200',
  unchecked: 'bg-slate-50 text-slate-600 ring-slate-200',
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default function SourcesTable({ sources }: { sources: Source[] }) {
  const cited = sources.filter((s) => s.cited).length
  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        {sources.length} sources read, <span className="font-medium text-slate-800">{cited} cited</span> in the report. Uncited
        sources are kept here for transparency but never appear in References.
      </p>
      <div className="overflow-x-auto">
        {/* table-fixed + overflow-wrap:anywhere: some "titles" are 200-character URLs with no spaces */}
        <table className="w-full min-w-[440px] table-fixed text-left text-sm [&_td]:[overflow-wrap:anywhere]">
          <thead className="text-xs text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="w-11 py-2.5 pr-2 font-medium">ID</th>
              <th className="py-2.5 pr-3 font-medium">Source</th>
              <th className="w-12 py-2.5 pr-2 font-medium" title="Sub-question it was found for">Sub-q.</th>
              <th className="w-28 py-2.5 font-medium">Citing claims</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className={`border-b border-slate-100 align-top ${s.cited ? '' : 'text-slate-500'}`}>
                <td className="py-3 pr-2">
                  <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ${s.cited ? 'bg-apollo-soft text-apollo' : 'bg-slate-100 text-slate-500'}`}>
                    {s.id}
                  </span>
                </td>
                <td className="py-3 pr-3">
                  <a href={s.url} target="_blank" rel="noreferrer" className="group inline font-medium text-slate-900 hover:text-apollo">
                    {s.title || s.url}
                    <ExternalLink className="ml-1 inline h-3 w-3 text-slate-400 group-hover:text-apollo" />
                  </a>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                    {host(s.url)} · text: {s.extracted_by}
                  </div>
                </td>
                <td className="py-3 pr-2 text-xs" title={s.question}>
                  #{s.section}
                </td>
                <td className="py-3">
                  {s.cited ? (
                    <div className="flex flex-wrap gap-1">
                      {(Object.entries(s.claims) as [ClaimStatus, number][]).map(([status, n]) => (
                        <span key={status} className={`rounded-md px-1.5 py-0.5 text-xs ring-1 ${BADGE[status]}`}>
                          {n} {status.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs">not cited</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
