// Security: live checks from GET /api/system: which API keys are configured (presence
// only; values never leave the server), .env hygiene, a scan of tracked files for
// hard-coded keys, CORS, and the hard limits that guarantee every run terminates.

import { useEffect, useState } from 'react'
import { getSystem, type SystemInfo } from '../api'
import { Card, Empty, Pill } from '../ui'

const LIMIT_LABEL: Record<string, string> = {
  max_rounds: 'Max research rounds',
  timeout_seconds: 'Research wall-clock timeout (s)',
  search_max_retries: 'Search retries per call',
  llm_max_retries: 'LLM retries per call',
  request_timeout_seconds: 'HTTP request timeout (s)',
  recursion_limit: 'LangGraph recursion limit',
  max_gap_queries: 'Follow-up queries per round',
  verify_max_claims: 'Claims verified per report',
  hitl_wait_seconds: 'Human approval wait (s)',
  max_page_bytes: 'Max page download (bytes)',
}

// ok: true passed, false failed, null could not check, 'note' deliberate setting worth knowing about.
function Check({ ok, label, detail }: { ok: boolean | null | 'note'; label: string; detail: string }) {
  const look = ok === 'note' ? 'bg-amber-400/15 text-amber-300' : ok === null ? 'bg-white/10 text-zinc-300' : ok ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${look}`} aria-hidden="true">
        {ok === 'note' ? 'i' : ok === null ? '?' : ok ? '✓' : '!'}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-zinc-100">{label} <span className="sr-only">{ok === 'note' ? 'note' : ok === null ? 'unknown' : ok ? 'passed' : 'failed'}</span></p>
        <p className="text-xs text-zinc-400">{detail}</p>
      </div>
    </li>
  )
}

export default function Security() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    getSystem().then((s) => live && setInfo(s)).catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load system info.'))
    return () => {
      live = false
    }
  }, [tick])

  if (error) return <Card><Empty>{error}</Empty></Card>
  if (!info) return <Card><Empty>Running checks…</Empty></Card>

  const scan = info.secret_scan
  const c = info.checks
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Secrets & configuration" aside={<button onClick={() => setTick((t) => t + 1)} className="text-accent hover:underline">re-run checks</button>}>
          <ul className="divide-y divide-white/5">
            <Check ok={c.env_gitignored} label=".env is git-ignored" detail="Keys live in .env, loaded with python-dotenv." />
            <Check ok={c.env_tracked_by_git === null ? null : !c.env_tracked_by_git} label=".env is not committed" detail={c.env_tracked_by_git === null ? 'git not available to check.' : 'git ls-files .env is empty.'} />
            <Check ok={c.env_example_committed} label=".env.example committed" detail="Lists every variable without values." />
            <Check ok={scan.ran ? scan.findings.length === 0 : null} label="No hard-coded keys in tracked files" detail={scan.ran ? `${scan.files} tracked files scanned for key patterns.` : 'git not available to list tracked files.'} />
            <Check ok={true} label="Keys never sent to the browser" detail="This page receives only present / missing flags." />
            <Check ok={c.demo_switch === 0 ? true : 'note'} label={c.demo_switch ? 'Demo failure switch is on' : 'Demo failure switch off'} detail={c.demo_switch ? `APOLLO_DEMO_FAIL_SUBQUESTION=${c.demo_switch}: Topic B's sub-question ${c.demo_switch} search fails on purpose.` : 'No simulated outages.'} />
          </ul>
          {scan.findings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-md border border-red-400/30 bg-red-400/[0.05] p-3 font-mono text-[11px] text-red-300">
              {scan.findings.map((f, i) => <li key={i}>{f.file}:{f.line} · {f.kind} · {f.match}</li>)}
            </ul>
          )}
        </Card>

        <Card title="API keys" aside="presence only">
          <ul className="divide-y divide-white/5">
            {Object.entries(info.keys).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between py-2.5">
                <span className="font-mono text-xs text-zinc-200">{k}</span>
                <Pill status={v ? 'verified' : 'not_found'} label={v ? 'configured' : 'missing'} />
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-1 text-xs text-zinc-400">
            <p>LLM provider: <span className="font-mono text-zinc-200">{info.llm.provider}</span></p>
            <p>Verification chain: <span className="font-mono text-zinc-200">{info.llm.verify_chain.join(' → ')}</span></p>
            <p>CORS allowed origins: <span className="font-mono text-zinc-200">{c.cors_origins.join(', ')}</span></p>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Termination guarantees" aside="enforced in code">
          <dl className="divide-y divide-white/5">
            {Object.entries(info.limits).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2">
                <dt className="text-sm text-zinc-300">{LIMIT_LABEL[k] ?? k}</dt>
                <dd className="font-mono text-sm text-zinc-100">{v.toLocaleString('en-IN')}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Grounding rules">
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>• Sections are written only from retrieved source passages, never from model memory.</li>
            <li>• Every claim carries an inline [S#] citation that maps to a retrieved URL; uncited sentences are removed.</li>
            <li>• A sub-question with no supporting source says "Not found in sources."</li>
            <li>• Claims are re-checked against the source text (up to the per-report cap above); results are on the Verification page.</li>
            <li>• Failed or empty searches become warnings, never crashes.</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
