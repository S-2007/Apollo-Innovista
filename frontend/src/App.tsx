// App shell: sidebar navigation (13 pages, hash routed), a top bar with the run selector
// and run status, and the active page. All run data comes from the store (store.tsx).

import { useState } from 'react'
import { PAGES, useRoute, type PageKey } from './router'
import { StoreProvider, useStore } from './store'
import { Pill, fmtTime } from './ui'
import Dashboard from './pages/Dashboard'
import NewResearch from './pages/NewResearch'
import Analytics from './pages/Analytics'
import Agents from './pages/Agents'
import Planning from './pages/Planning'
import Claims from './pages/Claims'
import Contradictions from './pages/Contradictions'
import Sources from './pages/Sources'
import Gaps from './pages/Gaps'
import Security from './pages/Security'
import Cost from './pages/Cost'
import Verification from './pages/Verification'
import Reports from './pages/Reports'

const VIEW: Record<PageKey, () => JSX.Element> = {
  dashboard: Dashboard, new: NewResearch, analytics: Analytics, agents: Agents, planning: Planning,
  claims: Claims, contradictions: Contradictions, sources: Sources, gaps: Gaps, security: Security,
  cost: Cost, verification: Verification, reports: Reports,
}

// 16px line icons, one path set per page.
const ICON: Record<PageKey, string> = {
  dashboard: 'M2 2h5v6H2zM9 2h5v3H9zM9 7h5v7H9zM2 10h5v4H2z',
  new: 'M8 3v10M3 8h10',
  analytics: 'M2 14h12M4 12V8M8 12V4M12 12V6',
  agents: 'M8 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM3 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM13 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.2 5.3 3.8 10.7M8.8 5.3l3.4 5.4M4.5 12h7',
  planning: 'M3 3h10M3 6.5h10M3 10h6M3 13.5h4',
  claims: 'M3 8.5 6 11.5 13 4.5',
  contradictions: 'M3 4h7l-2-2M13 12H6l2 2',
  sources: 'M2 8h12M8 2c2 2 2.5 4 2.5 6S10 12 8 14M8 2C6 4 5.5 6 5.5 8S6 12 8 14M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z',
  gaps: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.5M8 11v.01',
  security: 'M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4z',
  cost: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 4.5V8l2.5 1.5',
  verification: 'M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4zM5.8 8.2l1.6 1.6 3-3',
  reports: 'M4 2h6l3 3v9H4zM10 2v3h3M6 8h5M6 10.5h5',
}

function Icon({ page }: { page: PageKey }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON[page]} />
    </svg>
  )
}

function Sidebar({ page, onNavigate }: { page: PageKey; onNavigate: () => void }) {
  const { runs } = useStore()
  const active = runs.filter((r) => r.status === 'running' || r.status === 'awaiting_input').length
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="px-4 pb-4 pt-5">
        <p className="font-display text-xl font-bold tracking-[0.3em] text-zinc-50">APOLLO</p>
        <p className="mt-0.5 text-xs text-zinc-400">Deep research · cited sources only</p>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {PAGES.map((p, i) => (
          <li key={p.key}>
            <a
              href={`#/${p.key}`}
              onClick={onNavigate}
              aria-current={page === p.key ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                page === p.key ? 'bg-accent/12 text-accent' : 'text-zinc-300 hover:bg-white/5 hover:text-zinc-100'
              }`}
            >
              <span className="w-4 text-right font-mono text-[10px] text-zinc-500">{i + 1}</span>
              <Icon page={p.key} />
              <span className="truncate">{p.label}</span>
              {p.key === 'new' && active > 0 && (
                <span className="ml-auto rounded bg-accent/15 px-1.5 font-mono text-[10px] text-accent">{active} live</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { runs, runId, select, selected, problem, setProblem } = useStore()
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-void/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <button onClick={onMenu} className="rounded-md border border-white/15 px-2 py-1 font-mono text-xs text-zinc-300 lg:hidden" aria-label="Open navigation">
          MENU
        </button>
        <label htmlFor="run-select" className="font-mono text-[11px] uppercase text-zinc-400">Run</label>
        <select
          id="run-select"
          value={runId ?? ''}
          onChange={(e) => select(e.target.value)}
          className="min-w-0 max-w-full flex-1 truncate rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent/70 focus:outline-none sm:max-w-md"
        >
          {!runs.length && <option value="">No runs yet</option>}
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {fmtTime(r.created_at)} · {r.topic}
            </option>
          ))}
        </select>
        {selected && <Pill status={selected.status} label={selected.status.replace('_', ' ')} />}
        {problem && (
          <p role="alert" className="flex basis-full items-start gap-2 font-mono text-xs text-amber-300 xl:ml-auto xl:basis-auto xl:max-w-xl">
            <span className="min-w-0 [overflow-wrap:anywhere]">! {problem}</span>
            <button onClick={() => setProblem(null)} className="text-zinc-400 hover:text-zinc-100" aria-label="Dismiss">×</button>
          </p>
        )}
      </div>
    </header>
  )
}

function Shell() {
  const page = useRoute()
  const [open, setOpen] = useState(false)
  const View = VIEW[page]
  const title = PAGES.find((p) => p.key === page)?.label
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-white/10 bg-black/30 lg:block">
        <Sidebar page={page} onNavigate={() => undefined} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-white/10 bg-void">
            <Sidebar page={page} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="min-w-0">
        <TopBar onMenu={() => setOpen(true)} />
        <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
          <h1 className="mb-5 font-display text-2xl font-semibold tracking-wide text-zinc-50">{title}</h1>
          <View />
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
