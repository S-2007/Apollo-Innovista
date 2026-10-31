// Every source Athena collected: id, title, URL (new tab), section, and how the
// claims that cite it were verified ("not cited" if the report never cites it).

import type { ClaimStatus, Source } from '../api'

export const BADGE: Record<ClaimStatus, string> = {
  verified: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-amber-100 text-amber-800',
  not_found: 'bg-red-100 text-red-800',
  unchecked: 'bg-zinc-100 text-zinc-600',
}

export default function SourcesTable({ sources }: { sources: Source[] }) {
  return (
    <div className="overflow-x-auto">
      {/* table-fixed + overflow-wrap:anywhere: some "titles" are 200-character URLs with no spaces */}
      <table className="w-full min-w-[500px] table-fixed text-left text-sm [&_td]:[overflow-wrap:anywhere]">
        <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
          <tr>
            <th className="w-10 py-2 pr-2">ID</th>
            <th className="py-2 pr-2">Title</th>
            <th className="w-40 py-2 pr-2">URL</th>
            <th className="w-12 py-2 pr-2">Sec.</th>
            <th className="w-28 py-2">Citing claims</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className="border-b border-zinc-100 align-top">
              <td className="py-2 pr-3 font-medium">{s.id}</td>
              <td className="py-2 pr-3">
                {s.title || '(no title)'}
                <div className="text-xs text-zinc-400">text: {s.extracted_by}</div>
              </td>
              <td className="py-2 pr-3 text-xs">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                  {s.url}
                </a>
              </td>
              <td className="py-2 pr-3" title={s.question}>{s.section}</td>
              <td className="py-2">
                {s.cited ? (
                  <div className="flex flex-wrap gap-1">
                    {(Object.entries(s.claims) as [ClaimStatus, number][]).map(([status, n]) => (
                      <span key={status} className={`rounded px-1.5 py-0.5 text-xs ${BADGE[status]}`}>
                        {n} {status.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-zinc-400">not cited</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
