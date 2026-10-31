// Small shared building blocks for the pages: card, stat tile, stacked bar, status pill,
// empty states, and number/time formatters. Colours follow index.css: one cyan accent,
// emerald / amber / red only for verification outcomes and warnings.

import type { ReactNode } from 'react'
import type { ClaimStatus } from './api'
import { go } from './router'

export function Card({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="font-display text-sm font-semibold tracking-wide text-zinc-100">{title}</h2>}
          {aside && <div className="font-mono text-[11px] text-zinc-400">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, tone = 'normal' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'normal' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const color = { normal: 'text-zinc-50', good: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-red-300', accent: 'text-accent' }[tone]
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

export const STATUS_COLOR: Record<ClaimStatus, string> = {
  verified: 'bg-emerald-400',
  partial: 'bg-amber-400',
  not_found: 'bg-red-400',
  unchecked: 'bg-zinc-500',
}

export const BADGE: Record<string, string> = {
  verified: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  partial: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  not_found: 'border-red-400/40 bg-red-400/10 text-red-300',
  unchecked: 'border-white/15 bg-white/5 text-zinc-300',
  complete: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  running: 'border-accent/50 bg-accent/10 text-accent',
  awaiting_input: 'border-accent/50 bg-accent/10 text-accent',
  failed: 'border-red-400/40 bg-red-400/10 text-red-300',
  rejected: 'border-white/15 bg-white/5 text-zinc-300',
}

export function Pill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[11px] ${BADGE[status] ?? BADGE.unchecked}`}>
      {label ?? status.replace('_', ' ')}
    </span>
  )
}

/** One horizontal bar split into coloured parts; widths are shares of the total. */
export function StackedBar({ parts, height = 'h-2.5' }: { parts: { value: number; color: string; label: string }[]; height?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0)
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-white/5 ${height}`} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
      {total > 0 && parts.map((p) => p.value > 0 && <div key={p.label} className={p.color} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${p.value}`} />)}
    </div>
  )
}

export function Legend({ items }: { items: { color: string; label: string; value?: number }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-sm ${i.color}`} aria-hidden="true" />
          {i.label}
          {i.value !== undefined && <span className="font-mono text-zinc-200">{i.value}</span>}
        </span>
      ))}
    </div>
  )
}

/** A single bar relative to a maximum (for per-row comparisons in tables). */
export function Meter({ value, max, color = 'bg-accent' }: { value: number; max: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
      <div className={`h-full ${color}`} style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-zinc-400">{children}</p>
}

/** Shown on run-specific pages when there is no run, or the run has no report yet. */
export function NeedsRun({ what, busy }: { what: string; busy?: boolean }) {
  return (
    <Card>
      <div className="py-10 text-center">
        <p className="text-sm text-zinc-300">{busy ? `${what} appears when the run finishes writing its report.` : `No ${what.toLowerCase()} yet.`}</p>
        {!busy && (
          <button onClick={() => go('new')} className="mt-4 rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 font-display text-sm text-accent hover:bg-accent hover:text-void">
            Start a research run
          </button>
        )}
      </div>
    </Card>
  )
}

export const fmtInt = (n: number) => n.toLocaleString('en-IN')
export const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`)
export const fmtMs = (ms: number) => fmtSec(ms / 1000)
export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–')
export const fmtTime = (ms: number) => new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const STOP_REASON: Record<string, string> = {
  hermes_complete: 'Hermes judged the sources sufficient',
  max_rounds_reached: 'Round limit reached',
  timeout: 'Time limit reached',
  no_follow_up_queries: 'No new follow-up queries',
  gaps_skipped_by_user: 'Gap queries skipped by you',
  plan_rejected_by_user: 'Plan rejected by you',
  error: 'Stopped by an error',
}
