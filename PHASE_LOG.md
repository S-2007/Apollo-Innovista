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


## Phase 3.1: 13-page navigation with real data (2026-10-31)

**Asked:** sidebar navigation with 13 working sections: Dashboard, New Research, Analytics, Agent Orchestration,
Research Planning, Claims & Evidence, Contradictions, Source Intelligence, Research Gaps, Security, Cost & Execution,
Verification, Final Reports.

**Data behind each page (nothing is sample data):**
- New backend endpoints: `GET /api/runs` (run list with counts), `GET /api/runs/{id}/metrics` (usage meter and stage
  timings), `GET /api/system` (key presence, .env checks, secret scan of tracked files, limits). `/report` now also
  returns `plan`, `rounds`, `errors`, `sections` and `citation_check`.
- `metering.py`: `llm.chat` records every attempt (provider, model, tokens as the provider reports them, time, error);
  the API's search wrapper records every query. Calls are filed by run and graph node using LangGraph's own config
  (`thread_id` = run id), so concurrent runs do not mix.
- Finished runs are saved to `output/runs/<id>/run.json` and reloaded at startup, so history, analytics and reports
  survive a restart.
- Change to Phase 1 code: `llm.py` only (metering hook; behaviour unchanged). Graph, tools and verifier untouched.

**Checks**
1. `pytest` → 62 passed (3 new: meter attribution per run/node with no invented cost; run list + reload from disk;
   `/api/system` never returns key values).
2. `npm run build` (tsc strict + vite) passes.
3. Live run, Topic B, Groq, demo switch 2: 21 sources, 17 claims (6 verified, 10 partial, 1 not found), 50 LLM calls /
   28.4k tokens metered, 8 searches with the 1 simulated failure; 30 inline citations, 0 dangling. All 13 pages
   opened in the browser with this run; 375 px width has no horizontal scroll.
4. Restarting the server kept both runs (list, report, metrics).

**Bugs found while checking (fixed)**
- Stage timings treated events as stage starts; events fire when a node finishes, so planning showed 0 s. Now each
  event closes the stage it names; stages add up to the wall time (150 s run: 2.2 + 25.4 + 30.8 + 16.5 + 4.7 + 15.6 + 54.7).
- "Inline citations" showed distinct ids (`find_citations` de-duplicates); it now counts every occurrence.
- Long topics overflowed into the next column in the Dashboard and Analytics tables.
- A run-list error from a backend restart stayed on screen after the backend came back.

**Known gaps**
- A Gemini run during testing got 503 "high demand" on 15 of 16 calls; it still completed, with 0 claims. The Cost
  page made the cause visible. Groq was used for the check above.
- No live run produced a contradiction, so the Contradictions page was seen only in its empty state live.
- Runs made before metering show 0 tokens/searches.

## Phase 3.2: APOLLO light UI migration (2026-10-31)

**Asked:** replace the presentation layer with the APOLLO interface (light scientific theme, token-based design
system, sidebar with status/AI core/user, top bar with live monitor, richer modules per section) without changing
backend behaviour or inventing data. No target files were attached, so the written spec was the source of truth.

**What changed**
- `index.css`: design tokens (#ECEEF1 / #F5F6F7 / #FFFFFF, ink #111318, muted #68717D, blue #4C9AFF / #3B82F6,
  warning #F0B74B, error #EF6673, line/hair borders). Blue text uses `accent-ink` #1F5FC8 because the spec blues are
  below 4.5:1 on white. Print stylesheet for "PDF (print)".
- `ui.tsx` primitives: Panel, PageHeader, Stat, Pill (status always written out), StackedBar, Legend, Meter,
  BarChart (+ screen-reader table), Segmented, Confirm, Unavailable, NeedsRun, `bucketize`, `download`.
- `insights.ts`: classifies the run's own error lines (blocked/paywalled, PDF skipped, no main text, uncited sentence
  removed, invalid citation removed, quota switch...) and a domain-name heuristic for source category.
- Router: `#/<page>?run=<id>` deep links (share link); existing `#/<page>` URLs unchanged.
- Backend: one additive field, `similarity` on each `/report` verification row (already in graph state).
- Rejecting the plan (HITL panel) and Terminate now ask for confirmation.

**Shown as unavailable instead of invented:** academic search, credibility/authority/originality scores, publication
dates, AI-generated-content and prompt-injection detection, conflict classification, false-premise detection, pause /
mid-run cancel, per-run source/agent/priority/strictness settings, document upload, category field, platform
benchmarks, DOCX export.

**Checks**
1. `npm run build` (tsc strict + vite) passes; `pytest` 62 passed.
2. Every page opened with the saved Topic B run; 375 px: no horizontal scroll on all 13 pages; 768 px drawer works.
3. Deep link `#/reports?run=<older id>` opened that run.
4. Live HITL run: plan appeared on Research Planning, Terminate → confirm → run `rejected / plan_rejected_by_user`.

**Bugs found while checking (fixed):** floated legend broke the depth selector; report section numbers started at 2
(StrictMode double render with a counter); session selector collapsed on phones; nav drawer ignored Escape;
live badge truncated the nav label.

## Phase 3.3: "0 contradictions" vs "not checked" (2026-10-31)

**Question:** most runs show 0 contradictions: broken or expected?
**Findings:** detection works: Hermes found a planted conflict (18% yield gain vs no change) on the first call; no saved
run dropped a contradiction. 0 is mostly expected on descriptive topics (sources complement each other); Hermes also
sees only ~400 chars per source, chosen per sub-question, with a strict prompt, so recall is limited and varies.
**Bug fixed:** when every Hermes review failed (run b4caa31b: Gemini 503), the UI still said "No conflicts found".
- Backend: `contradictions` event, `/report` (`review_health`) and `/api/runs` rows now carry `reviews` and
  `reviews_failed` (counted from Hermes failure lines in state errors; works for saved runs too).
- Frontend: `conflictCheck()` → checked / partial / not_checked. Contradictions page, event feed, report section,
  Agents, Research Gaps and the Verification checklist show "Not checked" instead of 0.
**Checks:** `pytest` 64 passed (2 new); `npm run build` passes; b4caa31b shows "Not checked (1 of 1 review failed)",
73181002 shows "No conflicts found … 2 of 2 reviews ran".

## Phase 3.4: LLM fallback chain; "not written" is not "not found" (2026-10-31)

**Reported:** "it runs only 1 round and the answer says not found, but the references are fine" (run d8b0c604,
"what is A star algorithm").
**Root cause (from the usage meter):** plan and Hermes calls succeeded, then all 5 parallel `write_section` calls got
Groq 429 for gpt-oss-120b (quota nearly spent; small requests still passed). Planning, review and writing had no model
fallback (only verification did), and `write_section` wrote "Not found in sources." when the LLM failed, which is
false: the 14 sources were fine. The single round was Hermes judging the sources sufficient (`hermes_complete`):
`max_rounds` is a cap, not a target.
**Fix**
- `config.LLM_CHAIN` (default LLM_PROVIDER's model first, then the others; `LLM_CHAIN` in .env overrides) and
  `llm.chat` walks it when no model is pinned; a model whose daily quota is spent cools down for
  `LLM_COOLDOWN_SECONDS` (600). Pinned calls (verification's own chain) are unchanged. Meter keeps 400 error chars.
- `tools.text.WRITE_FAILED`: a section no model could write says so; NOT_FOUND stays reserved for "sources do not
  answer". `section_written` events and `/report` sections carry `write_failed`; feed, Planning, Verification
  (new checklist item) and Gaps show "not written".
**Checks:** `pytest` 70 passed (6 new in `tests/test_llm_chain.py`); `npm run build` passes. Live rerun of the same
query: Groq 120b and 20b both 429 → Gemini wrote all 5 sections; 2 rounds; 21 claims, 19 verified, 2 partial.
**Note:** saved run d8b0c604 still says "Not found in sources" (recorded before the fix).

## Phase 3.5: Live Report: the report builds on screen while the agents work (2026-10-31)

**Asked:** do not make the user wait for a separate finished report; open a new page that streams it.
**Backend (additive events, frozen contract fields unchanged)**
- `live.py`: nodes publish mid-step events to the run's SSE stream (run found via LangGraph's thread_id).
- `llm.chat(on_text=...)` streams replies (Groq `stream=True`, Gemini `generate_content_stream`; token usage from
  the final chunk). `write_section` publishes `section_draft {index, text}` at most every 0.25 s.
- New events: `search_results {query, results}` (raw hits per query, from the API's search wrapper),
  `report_written {markdown}` (full text before claim verification). `section_written` gains `text`;
  `search_done` gains `sources [{id,title,url}]`. Drafts are not saved to run.json.
- Default chains gain `gemini-flash-lite-latest` (`GEMINI_FALLBACK_MODEL`), a second Gemini model with its own
  capacity, after `gemini-3.1-flash-lite` returned 503 "high demand" during testing.
**Frontend:** `#/live` (Live Report). Launching from Dashboard / New Research opens it; the top-bar Live button
opens it (it replaces the live-monitor drawer). It shows: plan headings → web hits per sub-question → numbered
sources → each section streaming as a labelled draft, then its final cited text → full report while claims are
verified → the verified report with counts, in place. Stage strip, timer, sources column, optional event log.
**Checks:** `pytest` 73 passed (3 new: drafts precede final sections and full text precedes verification; drafts not
saved; search hits precede search_done). `npm run build` passes. Live (Focused, "binary search…"): first web hits at
3.3 s (previously the first sources appeared at ~26 s), sections at ~53 s, full text at ~59 s while verification ran
until ~2m48s; 18 of 20 claims verified; no horizontal scroll at 375 px.
**Known:** Groq's daily quota was spent (~198.8k/200k) during testing, so these runs used Gemini, which streams in
few large chunks: drafts appear in bursts rather than word by word.

## Phase 3.6: contradiction map fix; accounts with JWT (2026-10-31)

**Graph not showing (fixed).** The pyvis map rendered its own "Contradiction map" heading twice and a fixed 650 px
canvas inside a 520 px iframe, so the nodes sat off-screen (run 4f27084c showed one node's edge). Now: no in-map
heading, the canvas fills the frame (100vh, no margins/scroll), larger nodes, red 3 px edges with readable labels and
a 320 px edge length. `/api/runs/{id}/contradictions` rebuilds the map from the saved state, so old runs get the fix.
**Accounts.** `auth.py`: register / login with scrypt-hashed passwords (stdlib) in SQLite (`AUTH_DB`), JWT HS256
sessions (`PyJWT==2.10.1`, `JWT_SECRET`, `JWT_TTL_HOURS`=12) in an HttpOnly SameSite=Strict cookie (`Bearer` also
accepted), generic "Incorrect email or password", 5 failed logins per email per 15 min → 429. Endpoints
`/api/auth/register|login|logout|me`; every other route requires a session. Runs carry an `owner`; other users get 404
for them; ownerless (pre-accounts) runs stay visible to all. Frontend: sign-in / create-account screen, 401 anywhere
returns to it, sidebar shows the user with Sign out. A random `JWT_SECRET` was added to the local `.env`.
**Checks:** `pytest` 85 passed (12 in `tests/test_auth.py`; API tests now use a signed-in client); `npm run build`
passes. In the browser: unauthenticated `/api/runs` → 401; short-password error; register → dashboard; sign out →
sign-in screen; wrong password → generic error; sign in; reload keeps the session; the map iframe loads with the
cookie; `document.cookie` is empty (token not readable by scripts). The test account was deleted afterwards.
**Not done:** email verification, password reset, account deletion UI, admin roles.

## Phase 3.7: database (Neon Postgres or local SQLite); simpler sidebar footer (2026-10-31)

**Asked:** add a database for deploying on Neon; remove the sidebar's system status / backend lines and the line
under the user's name.
**Database (`db.py`, SQLAlchemy 2.0.36 Core + psycopg 3.2.3):** `DATABASE_URL` (Neon `postgresql://…?sslmode=require`;
the scheme is pointed at psycopg 3) or, when empty, `output/apollo.db` (SQLite). Tables `users` and `runs` are created
on first use; `runs.doc` (JSONB on Postgres) holds events, final state and usage calls. NUL characters are stripped
before saving (Postgres JSON rejects them). Pooled Postgres connections are pre-pinged and recycled every 5 min (Neon
closes idle connections). `auth.py` and api.py persistence now use the database; `report.md` is rendered from the stored
state, and the contradiction map was already rebuilt from it, so a redeploy loses nothing. At startup the older
`output/users.db` and `output/runs/*/run.json` are imported once (password hashes kept; run owners remapped to the new
user ids). The Security page shows the database type (never the URL).
**Sidebar:** removed "System status" and "AI core"; the footer shows initials, the user's name (email on hover) and
Sign out.
**Checks:** `pytest` 91 passed (6 new in `tests/test_database.py`: Neon URL handling, round trip without drafts or NUL,
report download with no local files, one-time idempotent import with the old password still valid); `npm run build`
passes. Local start imported 1 account and 10 runs into `output/apollo.db`; the dashboard lists them after sign-in.
**Not verified:** a live Neon database (no `DATABASE_URL` was provided); the Postgres path is covered by SQLAlchemy and
the URL test only.

## Phase 3.8: a new account no longer sees other people's (imported) runs (2026-10-31)

**Reported:** after signing in or signing up, the dashboard showed runs imported from before accounts existed.
**Cause:** `_visible()` let every signed-in user see ownerless runs (10 imported runs had `owner IS NULL`).
**Fix:** a run is visible only to its owner; ownerless runs are hidden from everyone (404 like a missing run).
`scripts/claim_runs.py` lists ownerless runs and, with `--email`, assigns them all to that account (restart the
backend afterwards). No new dependencies.
**Checks:** `pytest` 92 passed (ownerless runs hidden from two accounts; claim script assigns only ownerless runs and
rejects an unknown email).

## Phase 3.9: no sample content that looks like another user's history (2026-10-31)

**Reported:** a user should see only their own searches, nothing that looks like someone else's recent history.
**Change:** removed the dashboard's "Suggested research topics" panel and the New Research DEMO A/B buttons (demo
fixtures from `demo/topics.md`, with developer notes), and replaced the objective placeholder (an old demo topic that
read like earlier input) with "Type your research question". With Phase 3.8 (runs visible only to their owner), a
fresh account now shows 0 sessions and an empty form. `/api/demo-topics` still exists for the demo script but is not
used by the UI.
**Checks:** `npm run build` passes; `pytest` 92 passed; in the browser the dashboard text shows 0 sessions and no
suggestions, and New Research has no DEMO buttons.

## Phase 3.10: agent strip and research form fit the space they are given (2026-10-31)

**Reported:** the agent strip in the Dashboard's narrow "Live intelligence" column was cramped (APOL… / ATHE… / HERM…,
labels cut off). It chose its columns from the window width, so a wide window forced four columns into ~340 px.
**Fix:** container queries (Tailwind 4 `@container`): below 36rem one full-width row per agent and Round | Elapsed as
two equal cells; from 36rem three equal agent cards with the stats below; from 56rem three cards plus a joined stats
column. The research form's settings grid now also switches to two columns by its own width (the Deep option was cut
off in the narrow New Research column).
**Checks:** `npm run build` passes; checked at 1440 px (Dashboard side column: three rows + two equal stats; New
Research: wide layout) and in the ~640 px pane (medium layout).

## Phase 3.11: free deployment (Hugging Face Spaces + Neon) (2026-10-31)

**Added (nothing existing changed in behaviour):** `Dockerfile` (Node 22 builds the frontend; Python 3.11 with
CPU-only torch; embedding model downloaded at build time; uvicorn on 7860 as user 1000), `.dockerignore` (`.env`,
`output/`, `*.db` excluded), README front matter for Spaces, `DEPLOY.md` (step-by-step), `scripts/migrate_to_db.py`
(copies the local SQLite accounts and runs into `DATABASE_URL`, password hashes kept, owners remapped, re-runnable),
and in `api.py` a static mount of `frontend/dist` on `/`, registered after every `/api` route and only when the build
exists. Local development is unchanged (Vite on 5173 proxies `/api`).
**Checks:** `pytest` 93 passed (new: migration into a target that already has another account, run twice); with the
backend on 8000, `/` serves the app (sign-in screen), `/assets/*.js` 200, `/api/auth/me` and `/api/runs` 401, Vite
dev on 5173 still works.
**Not verified:** the Docker build itself (Docker is not installed on this machine) and a live Neon database.

## Phase 3.12: torch-free build for Render's free plan (2026-10-31)

**Why:** Hugging Face now charges for Docker Spaces; Oracle's free VM needs a card. Render's free web service needs no
card but has 512 MB RAM, too little for PyTorch.
**Tried and rejected:** Gemini embeddings. The free tier allows 100 embedded texts per minute
(`EmbedContentRequestsPerMinute…FreeTier = 100`, each text in a batch counts); a run embeds about 2,000 sentences.
**Change (default behaviour unchanged):** `EMBED_BACKEND` in config (`torch` default; `onnx` = fastembed 0.9.1 running the
same all-MiniLM-L6-v2 through ONNX Runtime, batch 32, 2 threads). `requirements-render.txt` (no torch /
sentence-transformers / pytest), `Dockerfile.render` (sets `EMBED_BACKEND=onnx`, `MALLOC_ARENA_MAX=2`, pre-downloads the
ONNX model, listens on `$PORT`), `EXTRACT_WORKERS` now overridable by env (default 6). DEPLOY.md: Render (A) and
Oracle (B).
**Checks:** `pytest` 95 passed (2 new: onnx backend uses fastembed with low-memory settings and normalises; the default
backend never imports fastembed). In a separate torch-free venv: ONNX vs torch on a saved run's 15 claims × 150
sentences: vector cosine 1.0000, identical best-matching sentences and partial decisions; app + 2,000 sentences peak
301 MB; a real Focused run completed (15 sources, 5/5 sections, 17 claims: 6 verified, 11 partial).
**Risk:** full-run peaks of 457–540 MB on Windows (working set). Not measured on Linux (no Docker/WSL here); Render's
512 MB may be too small. A second test run was slow only because Groq's daily quota was spent and Gemini returned 503s.

## Phase 3.13: runs no longer stall in Review on Render (2026-10-31)

**Reported:** on Render the run gets stuck at the Review stage.
**Cause (from saved runs' events and meter):** Hermes' LLM call takes 1–18 s, but 8–54 s passed between the last
search and the review event on a laptop: building Hermes' prompt embeds every sentence of every source (~1,100) to pick
passages. On Render's 0.1 CPU that is minutes. Verification then re-embedded most of the same sentences.
**Fix:** (1) `tools/embed.py` caches each text's vector for the run (cleared at run start; thread-safe), so no sentence is
embedded twice; same vectors, everywhere. (2) `PASSAGE_RANKING=keyword` (passages chosen by shared words, no embedding)
and (3) `VERIFY_MAX_SENTENCES=N` (each claim compared with its N best keyword matches per source); both default off and
are set only in `Dockerfile.render` (keyword, 30).
**Measured on a saved 21-source run (ONNX):** local settings embed 1,124 sentences before the review and 1,179 in total
(the cache removed verification's repeats); Render settings embed 0 before the review and 398 in total. Verification:
same partial/not-found decision for 17/17 claims, same best-matching sentence for 15/17. Hermes' excerpts differ for
18/21 sources (keyword vs embedding pick different sentences), so Render's coverage verdicts can differ from local ones.
**Checks:** `pytest` 98 passed (new: embed cache computes each text once and keeps order; keyword ranking never embeds;
verification keyword limit keeps the best matches in source order).
