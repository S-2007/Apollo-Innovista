// Hash router: #/claims, optionally with ?run=<id> so a link opens a specific run
// (the "shareable research link"). No dependency; back button and reloads keep the page.
// Existing URLs (#/dashboard ... #/reports) are unchanged.

import { useEffect, useState } from 'react'

export const PAGES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'new', label: 'New Research' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'agents', label: 'Agent Orchestration' },
  { key: 'planning', label: 'Research Planning' },
  { key: 'claims', label: 'Claims & Evidence' },
  { key: 'contradictions', label: 'Contradictions' },
  { key: 'sources', label: 'Source Intelligence' },
  { key: 'gaps', label: 'Research Gaps' },
  { key: 'security', label: 'Security' },
  { key: 'cost', label: 'Cost & Execution' },
  { key: 'verification', label: 'Verification' },
  { key: 'reports', label: 'Final Reports' },
] as const

export type PageKey = (typeof PAGES)[number]['key']

const isPage = (k: string): k is PageKey => PAGES.some((p) => p.key === k)

function parse(): { page: PageKey; run: string | null } {
  const [path = '', query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { page: isPage(path) ? path : 'dashboard', run: new URLSearchParams(query).get('run') }
}

export const runFromUrl = () => parse().run

export const go = (page: PageKey) => {
  window.location.hash = `/${page}`
}

/** Absolute link that opens `page` with `runId` selected. */
export const shareUrl = (page: PageKey, runId: string) =>
  `${window.location.origin}${window.location.pathname}#/${page}?run=${encodeURIComponent(runId)}`

export function useRoute(): PageKey {
  const [page, setPage] = useState<PageKey>(() => parse().page)
  useEffect(() => {
    const on = () => {
      setPage(parse().page)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return page
}
