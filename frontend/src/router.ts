// Hash router: #/claims etc. No dependency; the back button and reloads keep the page.

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
const current = (): PageKey => {
  const k = window.location.hash.replace(/^#\/?/, '')
  return isPage(k) ? k : 'dashboard'
}

export const go = (page: PageKey) => {
  window.location.hash = `/${page}`
}

export function useRoute(): PageKey {
  const [page, setPage] = useState<PageKey>(current)
  useEffect(() => {
    const on = () => {
      setPage(current())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return page
}
