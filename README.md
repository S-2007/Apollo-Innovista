# Apollo: multi-agent deep research

Give Apollo one topic; get back one report in which **every claim cites a source it actually retrieved**,
each claim checked against that source's text.

| Agent | Role |
|---|---|
| **Apollo** (manager) | Splits the topic into 3–5 sub-questions, decides when to stop, writes the report |
| **Athena** (searcher) | Searches the web (Tavily, Serper fallback) and reads the pages |
| **Hermes** (reviewer) | Finds gaps and conflicting sources; sends follow-up queries or says "complete" |

The web app shows the agents working live, lets you approve or edit the plan and the follow-up queries,
and renders the verified report with clickable citations.

## Setup (5 steps)

Needs Python 3.11 and Node 20+. Commands are for Windows PowerShell; on macOS/Linux use
`.venv/bin/python` and `export VAR=value`.

1. **Python environment**
   ```powershell
   py -3.11 -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt
   ```
2. **API keys**: copy `.env.example` to `.env` and fill in `TAVILY_API_KEY`, `GROQ_API_KEY`, and optionally
   `SERPER_API_KEY` and `GEMINI_API_KEY`. Never commit `.env`.
3. **Frontend packages**
   ```powershell
   cd frontend; npm ci; cd ..
   ```
4. **Start the backend** (terminal 1, project folder)
   ```powershell
   .venv\Scripts\python -m uvicorn api:app --port 8000
   ```
5. **Start the frontend** (terminal 2), then open http://localhost:5173
   ```powershell
   cd frontend; npm run dev
   ```

The first run downloads the embedding model (all-MiniLM-L6-v2, ~90 MB) once.

Command line without the UI: `.venv\Scripts\python run_cli.py "your topic"` (add `--hitl` to approve steps in the
terminal). Tests: `.venv\Scripts\python -m pytest tests/` (offline, about 15 s).

## How the agents and the loop work

```
START → Apollo plans → (you approve/edit) → Athena searches → Hermes reviews → (you approve gaps) → Apollo decides
                                                ↑                                                     │
                                                └──────────── round 2 with Hermes' gap queries ───────┤
                                                                                                      ↓
              one writer per sub-question (parallel) → assemble → verify every claim → report.md + conflict map
```

- **Stopping is decided in code**, not by the LLM. Apollo stops when Hermes says complete, after 2 rounds, when the
  wall-clock limit (`TIMEOUT_SECONDS`, default 180 s) is reached, or when there are no new gap queries.
- **Writers see only their own section's sources.** Code removes citations to ids a writer was not given, and drops
  any sentence that cites nothing. A section without support reads "Not found in sources."
- **Verification:** for each cited sentence, the best-matching sentences of the cited source's retrieved text are
  found with embeddings, then an LLM answers yes/no. Result: verified / partial / not_found / unchecked.
- **Failures never crash a run.** A failed search, an unreadable page or a rate limit becomes an amber warning in
  the UI, and the run continues.
- The web API (`api.py`) runs the graph in a background thread and streams typed events (`events.py`) over
  Server-Sent Events. The frontend never reads raw graph state: `frontend/src/derive.ts` turns the event list
  into everything the UI shows. Event contract: see the docstring of `events.py` (`warning` is a non-terminal
  extension; `error` and `complete` end the stream).

| Path | What it is |
|---|---|
| `graph/` | LangGraph state, nodes (agents), workflow |
| `tools/` | search, page extraction, passage selection, retry policy, text helpers |
| `verify/`, `viz/`, `export.py` | claim verification, contradiction map, Markdown export |
| `api.py`, `events.py`, `metering.py` | FastAPI backend, event conversion, per-run usage meter (LLM calls, tokens, searches) |
| `frontend/` | "Mission Control" UI: React 18 + Vite + TypeScript (strict) + Tailwind 4; sidebar with 13 pages (`src/pages/`) |
| `demo/topics.md`, `DEMO.md` | demo topics and the 2-minute demo script |
| `PHASE_LOG.md` | what was built and verified in each phase, with known gaps |

## Known limits

- **Free-tier LLM quotas.** Groq allows 200,000 tokens per model per day, and one run uses about 30–60k. Every
  LLM call now falls back by itself along `LLM_CHAIN` (default Groq 120b → Groq 20b → Gemini; verification has its own
  chain). If every model is out, a section says "Section not written: the language model was unavailable" (never
  "not found in sources", which is reserved for questions the sources do not answer). Re-run when quotas reset.
- **Speed.** A run takes 2–4 minutes. Pages are downloaded with 15 s timeouts, so slow sites can use up the 180 s
  research budget and cut round 2 short. Raise `TIMEOUT_SECONDS` in `.env` if that matters for a demo.
- **Hermes is one LLM judgement over excerpts.** It can miss contradictions or report a scope difference as one.
  Detection varies between runs.
- **The verifier can be lenient**, especially when the same model family wrote the text. The Verification tab shows
  the matched source sentence so a person can check.
- **Source quality.** Social-media pages and off-topic results are not filtered out.
- **Database.** Users and finished runs are stored in Postgres when `DATABASE_URL` is set (e.g. a Neon connection
  string, `postgresql://USER:PASSWORD@HOST/DB?sslmode=require`), otherwise in a local SQLite file
  (`output/apollo.db`). Tables are created on first start; older `output/users.db` / `output/runs/*/run.json` data
  is imported once. Accounts use a JWT in an HttpOnly cookie; set `JWT_SECRET` in `.env`. Runs are private to their
  owner. Runs saved before accounts existed have no owner and are hidden from everyone; to keep them, run
  `python scripts/claim_runs.py --email you@example.com` (then restart the backend). No email verification or
  password reset yet; CORS is for the Vite dev origin only; set `COOKIE_SECURE=true` behind HTTPS.
- **Cost is shown in tokens.** A dollar estimate appears only if you set `PRICE_<PROVIDER>_INPUT_PER_M` /
  `_OUTPUT_PER_M` in `.env`; prices are not built in because free tiers and prices change.

## Future ideas

- Filter or down-rank low-quality sources before writing.
- An independent verifier from a different model family than the writer.
- Record which cited source supported each claim (today the verifier keeps only the best-matching sentence).
- Parallel search across sub-questions to keep two rounds well inside the time budget.
- Save runs to disk so a restart does not lose them.
