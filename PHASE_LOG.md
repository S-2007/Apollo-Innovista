# Apollo — Phase Log

## Phase 1 — CLI research loop (2026-10-31)

### Built
| File | Purpose |
|---|---|
| `config.py` | Loads `.env`; keys, LLM provider, `MAX_ROUNDS=2`, `TIMEOUT_SECONDS=180`, retry limits, caps |
| `llm.py` | One `chat()` wrapper; Groq or Gemini via `LLM_PROVIDER`; HTTP timeout + bounded retries |
| `graph/state.py` | `ResearchState` TypedDict (all required fields + loop bookkeeping) |
| `graph/nodes.py` | `apollo_plan`, `athena_search`, `hermes_review`, `decide`, `route_after_decide` |
| `graph/workflow.py` | StateGraph: START → plan → search → review → decide → (search \| END) |
| `tools/search.py` | Tavily → Serper fallback; never raises, logs to `errors` |
| `tools/extract.py` | requests + trafilatura, capped at 4000 chars, `""` on failure |
| `tools/jsonparse.py` | Safe JSON parser (strips code fences, finds `{...}`) |
| `tools/retry_policy.py` | tenacity policy: retry transient errors only (timeouts, 429, 5xx) |
| `run_cli.py` | Streams events, prints final summary |
| `tests/test_phase1.py` | 14 offline tests (LLM/search/extract faked) |

### Loop termination (enforced in code)
`decide` stops on, in order: Hermes `complete=true` → `round_no >= max_rounds` → wall-clock timeout →
no new gap queries. Athena also checks the timeout between queries. LangGraph `recursion_limit=25` is a
hard backstop. Every network call has an HTTP timeout and at most N retries.

### Verified
- `pytest tests/test_phase1.py` → **14 passed**. Covers: stops at max_rounds with round-2 gap queries
  searched; invalid Hermes JSON; all searches empty; one sub-question empty while others continue; search
  exception logged; retry limit (transient 3 attempts, permanent 1); timeout; plan fallback; Hermes
  contradictions citing unknown source ids are dropped; JSON parser.
- **Check 3 (live):** `TAVILY_API_KEY=invalid-key-for-test python run_cli.py "Impact of AI on Indian agriculture"`
  hit the real Tavily API, got `InvalidAPIKeyError`, logged it, and finished cleanly in 1.3s with `status=failed`.
- **Check 4:** verified with a fake search (`test_empty_result_for_one_subquestion_continues`).
- **Change after the first run:** a missing or invalid key was being retried with backoff (14.8s wasted).
  Added `retry_policy.py` so permanent errors fail at once. The same run now takes 1.3s.
- **Check 1 (live):** `python run_cli.py "Impact of AI on Indian agriculture"` → 5 sub-questions, 14 sources,
  Hermes `complete=true` after round 1, `status=complete`, `stop_reason=hermes_complete`, 111s, exit 0.
- **Check 2 (live):** `python run_cli.py "Measured yield impact of AI crop advisory apps for smallholder farmers in Odisha and Bihar"`
  → Hermes returned 3 gap queries, `[Apollo] Starting round 2 with gap queries: [...]`, all 3 searched (+3
  sources S10–S12), stopped `max_rounds_reached` at round 2/2, 55.8s, exit 0.

### Fixes made during live checks
- `llama-3.3-70b-versatile` returned 404 (not available to this Groq key). Default changed to
  `openai/gpt-oss-120b`, after listing the models the key can access.
- The CLI crashed printing a title containing `ﬁ` on the Windows cp1252 console. `run_cli.py` now writes UTF-8.
  The pipeline itself was not affected; the crash was in printing only.
- Real keys had been typed into `.env.example`. They were moved to `.env` (gitignored) and the placeholders
  restored. Nothing was committed.

### Known gaps / decisions
- `status` is `complete` or `failed` (no findings at all). The reason is in `stop_reason`
  (`hermes_complete`, `max_rounds_reached`, `timeout`, `no_follow_up_queries`).
- If Hermes returns invalid JSON, the run ends with `no_follow_up_queries`: there are no gaps to search.
- Hermes reviews snippets, not full page text. It may mark a sub-question as covered when the full page
  says something different.
- Extraction was weak in the first live runs (3/14 and 7/12 pages with text). It was fixed in Phase 1.1 below.
- Hermes judged check 1 "complete" although most of its sources had snippets only. Its verdict is only as
  good as the snippets it sees.
- LLM output is nondeterministic: the same topic can stop after round 1 on one run and reach round 2 on another.
- No report writing yet (Phase 2).

## Phase 1.1: extraction fix (2026-10-31)

### Root causes (measured on 17 live pages)
- Our trafilatura fetch got text from 8/17 pages. The failures were PDFs (trafilatura reads HTML only),
  publisher 403s, and social-media pages.
- One PDF download took 21.7s with `REQUEST_TIMEOUT_SECONDS=15`: `requests`' timeout limits the gap between
  packets, not the whole download.
- Pages were extracted one after another (47s for 17 pages).
- Tavily's own `raw_content` had text for 11/17 pages, including PDFs and some sites that refused us.
  Our fetch or Tavily together covered 13/17.

### Changes
| File | Change |
|---|---|
| `tools/search.py` | Tavily called with `include_raw_content="text"`; results carry `raw_content` (Serper: `""`) |
| `tools/extract.py` | Check Content-Type and skip non-HTML before downloading; stream with total deadline + 3 MB cap; extracts under 200 chars count as failed; new `page_content()` falls back to Tavily text |
| `graph/nodes.py` | `athena_search` assigns ids S1.. in order, then extracts the round's pages in parallel (6 threads) |
| `graph/state.py` | Finding has `extracted_by`: `trafilatura` / `tavily_raw` / `""` (snippet only) |
| `config.py` | `MIN_CONTENT_CHARS`, `MAX_PAGE_BYTES`, `EXTRACT_WORKERS` |
| `run_cli.py` | Prints the extraction method per source |

Still not done: no browser User-Agent spoofing, no getting around 403s.

### Verified
- `pytest tests/test_phase1.py` → **17 passed**. New tests: fallback to search-provider text, non-HTML skipped
  without downloading the body, IDs stay S1..S9 in order when extraction finishes in random order.
- Live: the PDF that took 21.7s is now skipped in 1.4s.
- Live check 1 again: 20 sources, **16 with page text** (6 trafilatura, 10 tavily_raw), 2 rounds,
  `hermes_complete`, **53.4s** (was 111s for one round), exit 0.
- Live check 2 again: 15 sources, **12 with page text**, round 2 reached with 3 gap queries,
  `max_rounds_reached`, 49.4s, exit 0.

### Known gaps
- About 20% of sources are still snippet-only (ResearchGate, some Facebook posts, some PDFs).
- **Source quality, not extraction:** Facebook posts and videos are getting in. One had 387 chars of
  `tavily_raw` text, which is probably page clutter rather than content. Some results are off-topic
  (a CB Insights company page, an app demo page). Phase 2 should filter or down-rank these before writing.
- `tavily_raw` text is collapsed plain text and may include navigation junk; trafilatura text is cleaner.

## Phase 2: cited report, verification, contradiction map, HITL, export (2026-10-31)

### Built
| File | Purpose |
|---|---|
| `graph/state.py` | Finding gets `section`; new `sections` (add-reducer, for parallel writers), `report`, `references`, `claims`, HITL flags |
| `graph/nodes.py` | Hermes gaps carry a section number; `review_plan` / `review_gaps` interrupts; `write_section` (one per section via `Send`); `assemble`; `verify_claims` |
| `graph/workflow.py` | MemorySaver checkpointer; `stream_research(..., auto_approve, review_gaps, on_interrupt)` drives pause/resume |
| `tools/text.py` | Sentence splitting, citation normalising (`[S1, S3]` → `[S1][S3]`), "not found in sources" handling |
| `verify/claims.py` | all-MiniLM-L6-v2 picks the best-matching source sentences; LLM yes/no → verified / partial / not_found |
| `viz/contradictions.py` | NetworkX + pyvis HTML (JS inlined); "No conflicts found" page when empty |
| `export.py` | `report.md` (report, References, claim table) + `findings.json` (incl. source text for auditing) |
| `scripts/check_citations.py` | Acceptance check 2 |
| `llm.py`, `tools/retry_policy.py` | Per-call model; `reasoning_effort=low`; 429 waits for `retry-after` (cap 30s) |

### Rules enforced in code (not only prompts)
- A writer gets only its section's findings. Citation ids not in that input are removed. Sentences with no
  citation are dropped, except "not found in sources" sentences. The writer gets one retry with feedback when
  a sentence was dropped. A section with no sources gets "Not found in sources." without calling the LLM.
- "The sources do not specify X" style sentences get the exact phrase appended. The pattern requires the
  sources to be the subject, so an uncited factual negative ("AI apps do not raise yields") is still dropped (tested).
- References are built only from ids cited in the final text. Duplicate sentences are removed across the report.
- Intro and conclusion may cite only ids already cited in the sections, or must say they summarise.
- Verification reads retrieved text only, using `VERIFY_MODEL=openai/gpt-oss-20b` (separate Groq
  rate-limit bucket from the writer).
- Human pause time is added back to the research clock, so approving slowly does not trigger the timeout (tested).

### Acceptance checks
1. **Pass.** Live `run_cli.py "Impact of AI on Indian agriculture"` → `output/check1/report.md` with intro,
   5 sections, conclusion, inline [S#], References. Exit 0 in every run (5 runs, 84–132s).
2. **Pass.** `scripts/check_citations.py` → `Failures: 0` on every live run; it also catches an injected
   `[S42]` (tested).
3. **Pass (mechanically).** Counts printed every run, e.g. verified=4 / partial=8 / not_found=0, and
   9 / 3 / 0 on the alcohol topic.
4. **Half done.** "No conflicts found" page generated (`output/check1/contradictions.html`). The conflict
   graph works with a contradiction (unit test checks the vis-network HTML), but **no live run produced a
   contradiction**: 0 across intermittent fasting, alcohol & heart, and India population peak. Inspection
   showed the snippets Hermes sees contain no head-on conflicts (cookie banners, reference lists, table
   headers). Hermes' prompt was sharpened once; it still found none, which is correct for its input.
5. **Pass.** `printf '\n\n\n' | python run_cli.py "..." --hitl` paused after the plan, resumed on approval,
   paused for gap queries, resumed, completed (status complete, 2 rounds).
6. **Pass.** `pytest tests/` → **39 passed** (17 Phase 1 + 22 Phase 2).

### Bugs found and fixed while running the live checks
- Tavily text was flattened to one line (Phase 1.1 bug), so sentence splitting failed on those pages. Line breaks are now kept.
- Honest "not found in the provided sources" sentences were being dropped. Variants are now normalised.
- Verifier saw only best match ±1 sentence and missed support ranked 4th–5th. It now sees the top 5 matches.
- Writer often omitted citations. Added one retry with feedback.

### Known gaps (most important first)
- **Report quality varies between runs** (3–11 sources cited, verified share 11–75%). Root cause: the writer
  sees only the first 1200 chars of each source, often boilerplate. Proposed fix: send each source's most
  relevant passages to the writer, chosen with the embedding model already in use.
- **Many claims are "partial".** The diagnosis showed the writer adding detail that is not in its sources
  (e.g. "a private-sector driven program"). The verifier is right to flag it.
- **Contradiction detection is limited by snippets** (see check 4). Proposed fix: give Hermes a short relevant
  excerpt per source. This changes Phase 1's "titles + snippets only" rule, so it needs a decision.
- Social-media and junk sources are not filtered yet.
- Groq free tier: 8k tokens/min and 1000 requests/day per model. One run is about 30–50 requests.

## Phase 2.1: relevant passages for writer and Hermes; stability fixes (2026-10-31)

### Changed
| File | Change |
|---|---|
| `tools/embed.py` (new) | Shared MiniLM model, owned by ONE dedicated worker thread (see "Bugs" below); 120s timeout per call |
| `tools/passages.py` (new) | `relevant_passages(text, question, budget)`: rank a source's sentences by similarity to the question, keep the best in source order; cached per source text; falls back to first N chars if embedding fails |
| `graph/nodes.py` | Writer gets each source's most relevant 1200 chars for its sub-question; Hermes gets the most relevant 400 chars per source instead of the search snippet (approved change to the Phase 1 "snippets only" rule) |
| `config.py` | `EXTRACT_MAX_CHARS` 4000 → 12000 (LLMs now see selected passages, not the page start); `HERMES_CHARS_PER_SOURCE`, `EMBED_TIMEOUT_SECONDS` |
| `tools/retry_policy.py` | A 429 whose `retry-after` exceeds 30s (a daily quota) is not retried; `is_quota_exhausted()` |
| `verify/claims.py` | Falls back from `gpt-oss-20b` to `gpt-oss-120b` when a daily quota is spent; if both are spent, the remaining claims are `unchecked` and no further LLM calls are made |
| `tests/conftest.py` (new) | Blanks all API keys during tests and clears the passage cache |

### Bugs found and fixed
1. **The tests were calling the real Groq API.** `verify/claims.py` holds its own `llm_chat` reference, which the
   test fixture did not replace. Each test run sent hundreds of real verification calls. This used up
   gpt-oss-20b's **200,000 tokens/day** limit and made the suite take 80–110s. Fix: the fake now covers it, and
   conftest blanks the keys. The suite now takes **~10s** and makes no network calls.
2. **Segmentation fault / deadlock.** The parallel section writers ran the torch model from several threads at
   once. A lock around encode() stopped the crash, but the run still hung later when the verify thread used the
   model. Confirmed with faulthandler stack dumps. Fix: a single worker thread owns the model. Stress-tested with
   the real model: 5 writer threads, then a separate thread, no hang.
3. **A spent daily quota looked like a hang.** Each verify call waited out 2 × 30s of retries and then failed
   anyway (40+ min per run). Fixed by points 2 and 3 of "Changed" above.

### Verified (live)
- `pytest tests/` → **45 passed in ~10s**, all offline.
- **Check 4 (conflict half): pass.** "Is moderate alcohol consumption good or bad for heart health?" → Hermes
  found 2 conflicts between 3 sources; `output/check4/contradictions.html` written (701 KB, JS inlined). Checked by
  hand against the source text:
  - **S4 vs S5 is a genuine conflict** (both quoted verbatim): S4 says moderate drinking's effect "as cardiovascular protector is
    considerable"; S5 says "even low consumption of beer, cider, or distilled spirits was associated with a 9%
    higher risk of cardiovascular death".
  - **S4 vs S11 is a false positive.** S11's "can directly damage heart muscle cells" comes from a passage about
    heavier drinking (a scope difference).
- Same run: 15 sources cited, **16 of 17 claims verified**, 1 partial (before passages: 1–5 verified out of 9–15).
- Check 2 on `output/check1` and `output/check4`: `Failures: 0`.
- Detection varies between runs: on the same topic, Hermes found contradictions in 3 of 5 runs with passages
  (0 of 4 runs with snippets only).
- Final check-1 run (after both Groq daily token quotas ran out): exit 0 in 233s; all 12 claims `unchecked`, with
  the reason logged. The circuit breaker worked as designed.

### Known gaps
- **Groq free-tier daily token limit (200k per model)** is the real constraint. One full run uses roughly
  30–60k tokens. Today's quota is spent, mostly by the test leak. For the demo: wait for the reset, or add
  Gemini (key already in .env) as a third verification fallback.
- **The research timeout can be overrun:** 209.6s against 180s in one run. The timeout is checked between steps,
  so a slow LLM call (rate limits) can run past it. The overrun is bounded by request timeouts × retries.
- Hermes still produces false positives (scope differences) and misses some conflicts. It is still one LLM
  judgement over excerpts.
- Junk and social-media sources are still not filtered.

## Phase 2.2: Gemini as a verification fallback (2026-10-31)

### Changed
| File | Change |
|---|---|
| `llm.py` | `chat(..., provider=None)`: provider per call, one cached client per provider |
| `config.py`, `.env.example` | `VERIFY_CHAIN` (default `groq:openai/gpt-oss-20b,groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite`); `GEMINI_MODEL` default → `gemini-3.1-flash-lite` |
| `verify/claims.py` | Walks `VERIFY_CHAIN` (providers without a key are skipped). A model with a spent daily quota is dropped for the rest of the report; when none are left, the remaining claims are `unchecked` |
| `tools/retry_policy.py` | Reads the HTTP status for all SDKs (Gemini `.code`, Groq `.status_code`, requests). Every 4xx except 429 is permanent, so a Gemini 404 is no longer retried. Reads Gemini's `retryDelay` from the error body. A daily quota = the error names a per-day quota, or the wait is > 120s. Per-minute waits are honoured up to 60s |

### Why gemini-3.1-flash-lite
`gemini-2.5-flash` (the old default) now returns 404 "no longer available to new users". Probed live:

| Model | Result |
|---|---|
| `gemini-flash-latest` | 504 timeout |
| `gemini-3-flash-preview` | answered "Red wine is red ⇒ wine is red" as **unsupported** (wrong) |
| `gemini-3.1-flash-lite` | 1.1s, correct |

A pinned name was chosen over the `-latest` aliases, which can change silently.

### Verified
- `pytest tests/` → **47 passed** (new: fallback through all three models then `unchecked`; providers without a key
  skipped; Gemini per-minute 429 retried with its 37s delay; per-day 429 not retried; 404 not retried).
- Live, with both Groq daily quotas spent and `LLM_PROVIDER=gemini` set as an environment override for the run:
  the log shows `quota exhausted for groq:openai/gpt-oss-20b; switching to groq:openai/gpt-oss-120b`, then
  `…; switching to gemini:gemini-3.1-flash-lite`. Result: **verified 16 / partial 1 / not_found 1 / unchecked 0**;
  15 sources cited; 183s; check 2 `Failures: 0`.

### Known gaps
- **Self-checking bias.** In that run, Gemini both wrote and verified the report. A spot check found one lenient
  "verified" (the best match was only a heading). Even the default setup uses two gpt-oss models (120b writes,
  20b verifies). An independent verifier from a different model family would be stronger.
- To demo while Groq's quota is spent, set `LLM_PROVIDER=gemini` in `.env`. Gemini's free tier has its own
  per-minute and per-day limits; a 429 is waited out (up to 60s), or the model is dropped if its daily quota is spent.

## Phase 3: web app (FastAPI + SSE, React + Vite + TypeScript) (2026-11-01)

### Built
| File | Purpose |
|---|---|
| `api.py` | FastAPI backend. In-memory run registry with a lock; the graph runs in a background thread; SSE events with ids (resume via `Last-Event-ID`) and a 15 s heartbeat; resume endpoint for plan/gap decisions; report, report.md download, contradiction map, demo topics, cache clear. A run failure becomes an `error` event + `complete`, never a 500 |
| `events.py` | `EventConverter`: LangGraph `updates` chunks → 12 typed events. The UI never sees graph state |
| `frontend/` | Vite 8 + React 19 + TS 7 + Tailwind 4 + react-markdown. 7 components: TopicForm, ProgressFeed, ApprovalPanel (plan + gaps), ReportView (citations, hover cards, verification markers, download), SourcesTable, VerificationTable, ContradictionsView |
| `demo/topics.md`, `DEMO.md`, `README.md` | Demo topics, 2-minute script, setup |
| `tests/test_phase3_api.py` | 9 offline API tests: event order over real SSE, failed search, HITL edit + skip, reject, graph exception → error event, validation, Last-Event-ID resume, demo topics + cache clear, demo switch |

### Decisions (agreed or flagged)
- **Max rounds 1–2, not 1–3.** The hard constraint "max 2 research rounds" wins over the Phase 3 spec; `max_rounds=3` gets a 422.
- **7 components instead of 9.** PlanApproval + GapApproval became one ApprovalPanel; DownloadButton is inside
  ReportView. All the specified behaviour is kept.
- **Topic B demo switch** (agreed with the user). Live search never returned empty, even for nonsense or 1,188-character
  queries. `APOLLO_DEMO_FAIL_SUBQUESTION=N` makes the N-th sub-question's search fail, **only for the exact Topic B
  text**, through Athena's normal error path, with the warning "simulated outage (demo switch …)". Off by default.
- **Phases 1–2 frozen.** `git diff 76c5d46 -- graph tools verify viz export.py llm.py config.py run_cli.py` is empty.
  The API only calls `build_graph`, `initial_state`, `write_report`, `write_contradiction_map`; the demo switch wraps
  `nodes.web_search` at runtime.

### Acceptance checks
1. **Pass.** `uvicorn api:app` started; `curl POST /api/runs` (Topic A) → `{"run_id": …}`; `curl -N …/events` → 25 events,
   ids 0–24 strictly in order, 15 heartbeats, the stream closed after `complete`, and the run reached round 2. (That
   run's LLM calls hit Groq's daily token limit; it degraded honestly, with amber warnings and "not found in sources".)
2. **Pass.** `npm run build` (`tsc -b && vite build`): no TypeScript errors; also after a clean `npm ci` from the lockfile.
3. **Pass.** Browser, Topic A: feed shows "Round 1…", "Hermes found 3 gap(s) in round 1", "Round 2…", "Apollo stops:
   maximum number of rounds reached"; report rendered with 8 clickable citations and hover cards; Sources tab has 21 rows.
4. **Pass.** Browser, HITL: plan pending → edited sub-question 2 → `search_started` round 1 contained the edited text →
   `gaps_pending` → Approve all → round 2 searched exactly those gaps → complete.
5. **Pass.** Browser, Topic B: amber "No results for <sub-question 2>" (simulated outage), run complete, section 2
   = "Not found in sources.", other sections cited normally.
6. **Pass.** Download: 200, `content-disposition: attachment; filename="apollo-report-….md"`; the citation checker
   reports `Failures: 0` on the downloaded file.
7. **Pass.** `pytest tests/` → 56 passed (47 Phase 1–2 + 9 Phase 3); `npm run build` passes.
8. **Pass after fixing the doc.** Followed DEMO.md from fresh PowerShell terminals. Two wrong steps were fixed: (a) the
   edited question was not visible in the feed when the script says so, so the feed now lists each round's queries;
   (b) tab 3 waits for gap approval after the demo, so the script now says to approve it.

### Bugs found by running it (fixed)
- Starting a new run briefly paired the new run id with the previous run's events and fetched a report too early
  (amber "report not ready"). Events are now stored with their run id.
- Hover cards overflowed the page (horizontal scroll); they now open leftwards.
- Some search results use a 215-character URL as their "title", which stretched the Sources table to 1,384 px. Fixed
  with a fixed table layout and `overflow-wrap:anywhere`.
- The demo buttons' accessible name was the long topic; they now have `aria-label` "Demo: Topic A/B".
- The Verification tab implied that all cited sources matched; it now says "best match among S1, S2" (Phase 2 does not record which).

### Known gaps
- **LLM quotas decide what a demo looks like.** Groq's 200k tokens/day per model ran out during testing; the live
  checks ran with `LLM_PROVIDER=gemini GEMINI_MODEL=gemini-flash-lite-latest` (env override), and
  `gemini-3.1-flash-lite` returned 503 "high demand" for part of the session.
- Round 1 page downloads (15 s timeouts) can use up most of the 180 s budget; one run skipped some round-2 queries at
  the timeout. Raise `TIMEOUT_SECONDS` for demos.
- The contradiction-map iframe was not exercised live in Phase 3: no live Phase 3 run produced a conflict. The
  "no conflicts" path was seen live; the map HTML itself was verified in Phase 2.1.
- The Phase 2 verifier marked a "…not found in sources [S3]…" sentence as verified (lenient); frozen logic, recorded here.
- Runs live in memory (lost on restart); localhost only; no auth, no database (as specified).
