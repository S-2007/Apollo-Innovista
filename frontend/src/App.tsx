// APOLLO application shell: left sidebar (brand, 13 hash-routed sections, system / AI core /
// user status) and a compact top bar (section, date, run selector, Live report button, mobile
// menu). All run data comes from the store (store.tsx).

import { useEffect, useState } from 'react'
import { PAGES, go, pageLabel, useRoute, type PageKey } from './router'
import { StoreProvider, useStore } from './store'
import { Pill, btn, fmtTime } from './ui'
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
import LiveReport from './pages/LiveReport'

const VIEW: Record<PageKey, () => JSX.Element> = {
  dashboard: Dashboard, new: NewResearch, analytics: Analytics, agents: Agents, planning: Planning,
  claims: Claims, contradictions: Contradictions, sources: Sources, gaps: Gaps, security: Security,
  cost: Cost, verification: Verification, reports: Reports, live: LiveReport,
}

// 16px line icons, one path set per section.
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
  live: 'M2 8h2l2-4 3 8 2-4h3',
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function StatusLine({ label, value, state }: { label: string; value: string; state: 'ok' | 'warn' | 'bad' | 'unknown' }) {
  const dot = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-err', unknown: 'bg-muted/40' }[state]
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 ${dot}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="label">{label}</p>
        <p className="truncate text-xs text-ink" title={value}>{value}</p>
      </div>
    </div>
  )
}

function Sidebar({ page, onNavigate }: { page: PageKey; onNavigate: () => void }) {
  const { runs, backendOk, system } = useStore()
  const live = runs.filter((r) => r.status === 'running' || r.status === 'awaiting_input').length
  const provider = system?.llm.provider
  const model = provider === 'groq' ? system?.llm.groq_model : system?.llm.gemini_model
  const keyName = provider === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'
  const coreOk = system ? system.keys[keyName] && (system.keys.TAVILY_API_KEY || system.keys.SERPER_API_KEY) : null

  return (
    <nav aria-label="System navigation" className="flex h-full flex-col bg-surface">
      <div className="border-b border-line px-5 pb-4 pt-5">
        <p className="font-display text-[22px] font-bold leading-none tracking-[0.22em] text-ink">APOLLO</p>
        <p className="label mt-1.5">Multi-agent research</p>
      </div>
      <p className="label px-5 pb-1 pt-4">System</p>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-3">
        {PAGES.map((p, i) => {
          const active = page === p.key || (page === 'live' && p.key === 'new')
          return (
            <li key={p.key}>
              <a
                href={`#/${p.key}`}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-3 px-5 py-[7px] text-[13.5px] ${active ? 'bg-accent/10 font-medium text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
              >
                {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent-strong" aria-hidden="true" />}
                <span className="w-4 text-right font-mono text-[10px] text-muted">{String(i + 1).padStart(2, '0')}</span>
                <Icon d={ICON[p.key]} />
                <span className="truncate">{p.label}</span>
                {p.key === 'new' && live > 0 && <span className="ml-auto shrink-0 bg-accent-ink px-1.5 font-mono text-[10px] text-white" aria-label={`${live} live run${live === 1 ? '' : 's'}`}>{live}</span>}
              </a>
            </li>
          )
        })}
      </ul>
      <div className="border-t border-line px-5 py-3">
        <StatusLine label="System status" value={backendOk === null ? 'Connecting…' : backendOk ? `Backend online · ${live} live run${live === 1 ? '' : 's'}` : 'Backend unreachable'} state={backendOk === null ? 'unknown' : backendOk ? 'ok' : 'bad'} />
        <StatusLine label="AI core" value={system ? `${provider} · ${model}` : 'Unknown'} state={coreOk === null ? 'unknown' : coreOk ? 'ok' : 'warn'} />
        <div className="mt-2 flex items-center gap-2.5 border-t border-hair pt-3">
          <span className="flex h-7 w-7 items-center justify-center bg-ink font-mono text-[11px] text-white" aria-hidden="true">LO</span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-ink">Local operator</p>
            <p className="truncate text-[11px] text-muted">No sign-in: backend has no auth</p>
          </div>
        </div>
      </div>
    </nav>
  )
}

function TopBar({ page, onMenu }: { page: PageKey; onMenu: () => void }) {
  const { runs, runId, select, selected, problem, setProblem, busy } = useStore()
  const title = pageLabel(page)
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <button onClick={onMenu} className={`${btn.secondary} lg:hidden`} aria-label="Open navigation">Menu</button>
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase tracking-wide text-muted sm:flex-none">
          APOLLO <span aria-hidden="true">/</span> <span className="text-ink">{title}</span>
        </p>
        <span className="hidden font-mono text-[11px] text-muted md:inline">· {today}</span>
        {/* below sm the session controls take their own full-width row */}
        <div className="order-last flex min-w-0 basis-full items-center gap-2 sm:order-none sm:ml-auto sm:basis-auto">
          <label htmlFor="run-select" className="label hidden sm:block">Session</label>
          <select
            id="run-select"
            value={runId ?? ''}
            onChange={(e) => select(e.target.value)}
            className="min-w-0 max-w-full flex-1 truncate border border-line bg-surface px-2 py-1 text-[13px] text-ink focus:border-accent-strong focus:outline-none sm:w-80 sm:flex-none"
          >
            {!runs.length && <option value="">No research sessions yet</option>}
            {runs.map((r) => <option key={r.run_id} value={r.run_id}>{fmtTime(r.created_at)} · {r.topic}</option>)}
          </select>
          {selected && <span className="hidden sm:inline"><Pill status={selected.status} /></span>}
          <button onClick={() => go('live')} className={btn.secondary} aria-label="Open the live report" aria-current={page === 'live' ? 'page' : undefined}>
            <span className={`h-1.5 w-1.5 ${busy ? 'bg-accent-strong' : 'bg-muted/40'}`} aria-hidden="true" />
            Live
          </button>
        </div>
      </div>
      {problem && (
        <div role="alert" className="flex items-start gap-3 border-t border-warn/60 bg-warn/15 px-4 py-1.5 text-xs text-warn-ink sm:px-6">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{problem}</span>
          <button onClick={() => setProblem(null)} className="font-mono underline" aria-label="Dismiss message">dismiss</button>
        </div>
      )}
    </header>
  )
}

function Shell() {
  const page = useRoute()
  const [menu, setMenu] = useState(false)
  const View = VIEW[page]
  useEffect(() => {
    if (!menu) return
    const on = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [menu])
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:p-2">Skip to content</a>
      <aside className="no-print sticky top-0 hidden h-screen border-r border-line lg:block">
        <Sidebar page={page} onNavigate={() => undefined} />
      </aside>
      {menu && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-ink/25" onClick={() => setMenu(false)} aria-label="Close navigation" />
          <div className="absolute inset-y-0 left-0 w-[272px] max-w-[85vw] border-r border-line">
            <Sidebar page={page} onNavigate={() => setMenu(false)} />
          </div>
        </div>
      )}
      <div className="min-w-0 bg-workspace">
        <TopBar page={page} onMenu={() => setMenu(true)} />
        <main id="main" className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8">
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
