// Security: live checks from GET /api/system (key presence only; values never leave the
// server), the controls the pipeline really applies to retrieved content, termination
// limits, and an audit log of content the run removed. Detection features the backend does
// not have (prompt-injection scanning, quarantine) are marked unavailable.

import { useMemo } from 'react'
import { classifyErrors } from '../insights'
import { useStore } from '../store'
import { Empty, PageHeader, Panel, Pill, Stat, Unavailable, btn } from '../ui'

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
  const pill = ok === 'note' ? ['warn', 'note'] : ok === null ? ['idle', 'unknown'] : ok ? ['done', 'pass'] : ['failed', 'fail']
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
      <Pill status={pill[0] ?? 'idle'} label={pill[1]} />
    </li>
  )
}

export default function Security() {
  const { system: info, refreshSystem, report } = useStore()
  const errs = useMemo(() => classifyErrors(report?.errors), [report])
  if (!info) return <><PageHeader kicker="10 · Security" title="Security monitoring" /><Panel><Empty>Running checks… (needs the backend)</Empty></Panel></>

  const scan = info.secret_scan
  const c = info.checks
  const failedChecks = [c.env_gitignored, c.env_tracked_by_git === false, c.env_example_committed, scan.findings.length === 0].filter((x) => !x).length
  const audit = [...(errs.uncited_dropped ?? []), ...(errs.bad_citation ?? []), ...(errs.non_html ?? [])]

  return (
    <div>
      <PageHeader kicker="10 · Security" title="Security monitoring">
        <button className={btn.secondary} onClick={refreshSystem}>Re-run checks</button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4 [&>*]:border-0">
        <Stat label="Config checks" value={failedChecks ? `${failedChecks} failing` : 'All pass'} tone={failedChecks ? 'bad' : 'good'} />
        <Stat label="Files scanned" value={scan.ran ? scan.files : '–'} sub={`${scan.findings.length} key-like strings`} tone={scan.findings.length ? 'bad' : 'normal'} />
        <Stat label="Content removed" value={audit.length} sub="by grounding filters, this run" />
        <Stat label="Injection detector" value="None" sub="not implemented" tone="warn" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel label="Secrets" title="Secrets & configuration">
          <ul className="divide-y divide-hair">
            <Check ok={c.env_gitignored} label=".env is git-ignored" detail="Keys live in .env, loaded with python-dotenv." />
            <Check ok={c.env_tracked_by_git === null ? null : !c.env_tracked_by_git} label=".env is not committed" detail={c.env_tracked_by_git === null ? 'git not available to check.' : 'git ls-files .env is empty.'} />
            <Check ok={c.env_example_committed} label=".env.example committed" detail="Lists every variable without values." />
            <Check ok={scan.ran ? scan.findings.length === 0 : null} label="No hard-coded keys in tracked files" detail={scan.ran ? `${scan.files} tracked files scanned for key patterns.` : 'git not available to list tracked files.'} />
            <Check ok={true} label="Keys never sent to the browser" detail="This page receives present / missing flags only." />
            <Check ok={c.demo_switch === 0 ? true : 'note'} label={c.demo_switch ? 'Demo failure switch is on' : 'Demo failure switch off'} detail={c.demo_switch ? `APOLLO_DEMO_FAIL_SUBQUESTION=${c.demo_switch}: Topic B's sub-question ${c.demo_switch} search fails on purpose.` : 'No simulated outages.'} />
          </ul>
          {scan.findings.length > 0 && (
            <ul className="mt-3 space-y-1 border border-err/50 bg-err/10 p-3 font-mono text-[11px] text-err-ink">
              {scan.findings.map((f, i) => <li key={i}>{f.file}:{f.line} · {f.kind} · {f.match}</li>)}
            </ul>
          )}
        </Panel>

        <Panel label="Keys" title="API keys & AI core" aside="presence only">
          <ul className="divide-y divide-hair">
            {Object.entries(info.keys).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between py-2.5">
                <span className="font-mono text-xs text-ink">{k}</span>
                <Pill status={v ? 'done' : 'failed'} label={v ? 'configured' : 'missing'} />
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1 text-xs">
            <div><dt className="label inline">LLM provider </dt><dd className="inline font-mono">{info.llm.provider}</dd></div>
            <div><dt className="label inline">Verifier chain </dt><dd className="inline font-mono">{info.llm.verify_chain.join(' → ')}</dd></div>
            <div><dt className="label inline">CORS origins </dt><dd className="inline font-mono">{c.cors_origins.join(', ')}</dd></div>
            <div><dt className="label inline">Database </dt><dd className="inline font-mono">{c.database === 'postgres' ? 'Postgres (DATABASE_URL)' : 'local SQLite (set DATABASE_URL for Neon)'}</dd></div>
          </dl>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel label="Retrieved content" title="Instruction isolation & sanitisation">
          <ul className="space-y-2 text-sm text-ink">
            <li>• Retrieved text reaches the LLM only as quoted source passages inside fixed system prompts that instruct the writer to use only those passages.</li>
            <li>• Every written sentence must cite a source it was given; others are dropped (see audit log).</li>
            <li>• Page downloads are capped at {info.limits.max_page_bytes?.toLocaleString('en-IN')} bytes with a {info.limits.request_timeout_seconds}s timeout; non-HTML content is skipped.</li>
          </ul>
          <div className="mt-4 space-y-2">
            <Unavailable what="Prompt-injection & malicious-instruction detection" need="a scanner over extracted page text; pages are not checked for embedded instructions." />
            <Unavailable what="Suspicious-page quarantine & blocked-instruction tracking" need="a detector above plus a quarantine flag on sources." />
          </div>
        </Panel>

        <Panel label="Audit log" title="Content removed in the selected run" aside={`${audit.length}`}>
          {!report ? <p className="text-sm text-muted">Select a run with a report.</p> : !audit.length ? <p className="text-sm text-muted">Nothing was removed.</p> : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto font-mono text-[11px] text-muted">
              {audit.map((e, i) => <li key={i} className="[overflow-wrap:anywhere]">• {e.text}</li>)}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel label="Runaway prevention" title="Termination guarantees" aside="enforced in code">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {Object.entries(info.limits).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 border-b border-hair py-2">
                <dt className="text-sm text-muted">{LIMIT_LABEL[k] ?? k}</dt>
                <dd className="font-mono text-sm text-ink">{v.toLocaleString('en-IN')}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  )
}
