"""FastAPI backend for the Apollo web app (Phase 3).

Runs the frozen Phase 1-2 graph in background threads and streams its progress
to the browser as Server-Sent Events. Endpoints:

  POST /api/auth/register            create an account {name, email, password}; signs in (cookie)
  POST /api/auth/login               sign in {email, password}; sets the session cookie
  POST /api/auth/logout              clear the session cookie
  GET  /api/auth/me                  the signed-in user, or 401
  POST /api/runs                     start a run {topic, max_rounds, hitl} -> {run_id}
  GET  /api/runs/{id}                status and any pending human decision
  GET  /api/runs/{id}/events         SSE stream of typed events (see events.py)
  POST /api/runs/{id}/resume         answer a pending interrupt {action, payload?}
  GET  /api/runs/{id}/report         report markdown, sources, verification, conflicts
  GET  /api/runs/{id}/report.md      download the exported Markdown report
  GET  /api/runs/{id}/contradictions        the pyvis contradiction map (text/html)
  GET  /api/runs                     every run (live and saved), newest first, with summary counts
  GET  /api/runs/{id}/metrics        LLM calls, tokens, searches and stage timings for one run
  GET  /api/system                   configuration and security posture (key PRESENCE only, never values)
  GET  /api/demo-topics              demo topics from demo/topics.md: [{id, title, topic, note}]
  POST /api/cache/clear              forget finished runs and cached embeddings

Every endpoint except /api/auth/* needs a session: a JWT in the HttpOnly `apollo_session` cookie (set by
login/register) or an `Authorization: Bearer <jwt>` header. Runs belong to the user who started them and
are visible only to that user. Runs saved before accounts existed have no owner and stay hidden until
claimed with `python scripts/claim_runs.py --email <account email>`.

Finished runs are saved as rows in the database (db.py: Neon Postgres via DATABASE_URL, or local SQLite) with
their events, final state and usage meter, and reloaded at startup, so history, analytics and reports survive a
restart or a redeploy. Run files from older versions (output/runs/*/run.json, output/users.db) are imported once.

Each run lives in an in-memory registry guarded by one lock: its event list,
status, pending interrupt, and a queue the graph thread waits on for the
human's answer. A run-level failure becomes an "error" event plus a "complete"
event with status "failed"; it never becomes an HTTP 500. Problems the run
survives (e.g. an unreadable page) are non-terminal "warning" events.

Demo switch (off by default): live web search practically never comes back
empty, so to SHOW the failed-search path, set APOLLO_DEMO_FAIL_SUBQUESTION=N.
Then, only for runs on demo Topic B (demo/topics.md), the search for the N-th
sub-question fails through Athena's normal error path, and the warning says
"simulated outage (demo switch ...)". The Phase 1-2 code is not edited; the
API layer wraps the search function it calls.

Run locally:  uvicorn api:app --port 8000
"""

import asyncio
import json
import logging
import os
import queue
import re
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select, update

import auth
import config
import db
import live
import metering
from events import EventConverter, make_event, warning_event
from export import render_markdown, write_report
from graph import nodes
from graph.state import initial_state
from graph.workflow import build_graph
from tools import embed, passages
from tools.text import CITE, NOT_FOUND, WRITE_FAILED, find_citations
from viz.contradictions import write_contradiction_map

VITE_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]  # the Vite dev server only
RUNS_DIR = Path(config.OUTPUT_DIR) / "runs"
DEMO_TOPICS_FILE = Path(__file__).parent / "demo" / "topics.md"
MAX_ROUNDS_LIMIT = 2         # hard project constraint: never more than 2 research rounds
HEARTBEAT_SECONDS = 15
HITL_WAIT_SECONDS = 15 * 60  # an unanswered approval is auto-approved after this, so a run always ends
ACTIVE = {"running", "awaiting_input"}
_REJECT = object()           # resume value meaning "cancel this run"

app = FastAPI(title="Apollo deep research")
app.add_middleware(CORSMiddleware, allow_origins=VITE_ORIGINS, allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------- run registry


class Run:
    def __init__(self, topic: str, max_rounds: int, hitl: bool, run_id: str | None = None, owner: str | None = None) -> None:
        self.id = run_id or uuid.uuid4().hex
        self.owner = owner                # user id; None = saved before accounts existed (hidden until claimed)
        self.created_at = int(time.time() * 1000)
        self.finished_at: int | None = None
        self.topic, self.max_rounds, self.hitl = topic, max_rounds, hitl
        self.status = "running"          # running | awaiting_input | complete | failed | rejected
        self.events: list[dict] = []
        self.pending: dict | None = None  # interrupt payload while waiting for a human
        self.answers: queue.Queue = queue.Queue()
        self.state: dict | None = None    # final graph state
        self.out_dir = RUNS_DIR / self.id
        self.plan: list[str] = []         # the approved plan (used only by the demo switch)
        self.fail_subquestion = 0         # demo switch: N > 0 makes the N-th sub-question's search fail


_runs: dict[str, Run] = {}
_lock = threading.Lock()


# ---------------------------------------------------------------- accounts

SESSION_COOKIE = "apollo_session"


def current_user(request: Request) -> dict:
    """The signed-in user from the session cookie or a Bearer token; 401 otherwise."""
    token = request.cookies.get(SESSION_COOKIE, "")
    header = request.headers.get("authorization", "")
    if not token and header.lower().startswith("bearer "):
        token = header[7:].strip()
    user = auth.user_from_token(token) if token else None
    if user is None:
        raise HTTPException(401, "Sign in to continue.")
    return user


User = Annotated[dict, Depends(current_user)]


def _visible(run: "Run", user: dict) -> bool:
    # Only the owner sees a run. Runs saved before accounts existed have no owner and are shown to
    # nobody until someone claims them (scripts/claim_runs.py), so one account never sees another's work.
    return run.owner is not None and run.owner == user["id"]


def _get(run_id: str, user: dict) -> Run:
    with _lock:
        run = _runs.get(run_id)
    if run is None or not _visible(run, user):  # someone else's run looks exactly like a missing one
        raise HTTPException(404, "unknown run_id")
    return run


def _emit(run: Run, events: list[dict]) -> None:
    if events:
        with _lock:
            run.events.extend(events)


def _finish(run: Run, status: str, data: dict) -> None:
    """Append the final event and set the status together, so SSE readers see both or neither."""
    with _lock:
        run.events.append(make_event("complete", {"status": "complete" if status == "complete" else "failed", **data}))
        run.status = status
        run.pending = None
        run.finished_at = int(time.time() * 1000)
    _save(run)


HERMES_FAILURES = ("hermes_review LLM call failed", "hermes_review got invalid JSON")


def _review_health(state: dict | None, events: list[dict]) -> dict:
    """How many Hermes reviews ran and how many failed. Contradictions are found only in those
    reviews, so "0 contradictions" means "none found" only when at least one review succeeded."""
    reviews = sum(e["type"] == "review" for e in events)
    failed = sum(e.startswith(HERMES_FAILURES) for e in (state or {}).get("errors", []))
    return {"reviews": reviews, "reviews_failed": min(failed, reviews)}


# ---------------------------------------------------------------- persistence


log = logging.getLogger("apollo")


def _clean(value):
    """Postgres JSON cannot hold NUL characters, which some scraped pages contain."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    return value


def _row(run: Run) -> dict:
    with _lock:
        doc = {
            # Drafts only matter while a section is being written; the final text is in section_written.
            "events": [e for e in run.events if e["type"] != "section_draft"],
            "state": run.state,
            "calls": metering.calls(run.id),
        }
        return {"id": run.id, "owner": run.owner, "topic": run.topic, "status": run.status, "max_rounds": run.max_rounds,
                "hitl": run.hitl, "created_at": run.created_at, "finished_at": run.finished_at, "doc": _clean(doc)}


def _upsert(conn, row: dict) -> None:
    if conn.execute(update(db.runs).where(db.runs.c.id == row["id"]).values(**row)).rowcount == 0:
        conn.execute(insert(db.runs).values(**row))


def _save(run: Run) -> None:
    """Store a finished run in the database. A failed write is logged; it never fails the run."""
    try:
        row = _row(run)
        with db.engine().begin() as conn:
            _upsert(conn, row)
    except Exception as exc:
        log.warning("could not save run %s: %s: %s", run.id, type(exc).__name__, str(exc)[:200])


def _import_legacy() -> None:
    """One-time import of the file stores used before the database: output/users.db (accounts, with
    their password hashes) and output/runs/*/run.json. Rows already in the database are left alone."""
    owner_map: dict[str, str] = {}
    legacy_users = Path(config.LEGACY_USERS_DB)
    if legacy_users.exists():
        try:
            src = sqlite3.connect(legacy_users)
            old = src.execute("SELECT id, email, name, password_hash, created_at FROM users").fetchall()
            src.close()
        except sqlite3.Error:
            old = []
        with db.engine().begin() as conn:
            for old_id, email, name, pw_hash, created in old:
                found = conn.execute(select(db.users.c.id).where(db.users.c.email == email)).scalar()
                if found is None:
                    found = conn.execute(insert(db.users).values(email=email, name=name, password_hash=pw_hash,
                                                                 created_at=created).returning(db.users.c.id)).scalar_one()
                owner_map[str(old_id)] = str(found)
    if not RUNS_DIR.exists():
        return
    with db.engine().begin() as conn:
        have = set(conn.execute(select(db.runs.c.id)).scalars())
        for path in RUNS_DIR.glob("*/run.json"):
            try:
                d = json.loads(path.read_text(encoding="utf-8"))
                if d["id"] in have:
                    continue
                owner = d.get("owner")
                conn.execute(insert(db.runs).values(
                    id=d["id"], owner=owner_map.get(str(owner), owner) if owner else None, topic=d["topic"],
                    status=d.get("status", "failed"), max_rounds=d["max_rounds"], hitl=bool(d["hitl"]),
                    created_at=d.get("created_at", 0), finished_at=d.get("finished_at"),
                    doc=_clean({"events": d.get("events", []), "state": d.get("state"), "calls": d.get("calls", [])}),
                ))
            except (OSError, ValueError, KeyError, TypeError):
                continue  # a damaged file is skipped, not fatal


INTERRUPTED_MESSAGE = ("This run was interrupted because the server restarted (for example it ran out of memory "
                       "or a new version was deployed). Please start it again.")


def _load_saved() -> None:
    """Load finished runs from the database (after importing any older file stores)."""
    try:
        _import_legacy()
        with db.engine().connect() as conn:
            rows = conn.execute(select(db.runs)).all()
    except Exception as exc:  # e.g. the database is unreachable: start anyway, with no history
        log.warning("could not load saved runs: %s: %s", type(exc).__name__, str(exc)[:200])
        return
    for r in rows:
        run = Run(r.topic, r.max_rounds, r.hitl, run_id=r.id, owner=r.owner)
        doc = r.doc or {}
        run.status, run.events, run.state = r.status, doc.get("events", []), doc.get("state")
        run.created_at, run.finished_at = r.created_at, r.finished_at
        interrupted = run.status in ACTIVE  # saved mid-run by an earlier server process: it can never finish now
        if interrupted:
            run.status, run.finished_at = "failed", run.finished_at or int(time.time() * 1000)
            run.events = run.events + [
                make_event("error", {"message": INTERRUPTED_MESSAGE}),
                make_event("complete", {"status": "failed", "stop_reason": "interrupted"}),
            ]
        metering.load(run.id, doc.get("calls", []))
        with _lock:
            _runs.setdefault(run.id, run)
        if interrupted:
            _save(run)  # record the outcome, so the next restart does not report it again


# ---------------------------------------------------------------- graph thread


def _execute(run: Run) -> None:
    converter = EventConverter()
    live.register(run.id, lambda type_, data: _emit(run, [make_event(type_, data)]))
    # Store the run as "running" right away: if the server restarts mid-run (out of memory, redeploy),
    # the next start finds it and marks it interrupted instead of the run silently disappearing.
    _save(run)
    try:
        graph = build_graph()
        cfg = {"configurable": {"thread_id": run.id}, "recursion_limit": config.GRAPH_RECURSION_LIMIT}
        payload: object = initial_state(
            run.topic, run.max_rounds, config.TIMEOUT_SECONDS, time.time(), auto_approve=not run.hitl
        )
        while True:
            for chunk in graph.stream(payload, cfg, stream_mode="updates"):
                for node, update in chunk.items():
                    if node == "__interrupt__":  # interrupts are read from the snapshot below
                        continue
                    if node == "review_plan" and update:
                        run.plan = update["plan"]
                    _emit(run, converter.from_update(node, update))
            snapshot = graph.get_state(cfg)
            if not snapshot.interrupts:
                break
            interrupt = snapshot.interrupts[0].value
            with _lock:
                run.pending, run.status = interrupt, "awaiting_input"
            _emit(run, converter.from_interrupt(interrupt))
            try:
                answer = run.answers.get(timeout=HITL_WAIT_SECONDS)
            except queue.Empty:
                answer = {"approved": True}
                _emit(run, [warning_event(["No answer within 15 minutes; auto-approved."], "waiting for you")])
            if answer is _REJECT:
                _finish(run, "rejected", {"stop_reason": "plan_rejected_by_user"})
                return
            with _lock:
                run.pending, run.status = None, "running"
            payload = Command(resume=answer)

        final = snapshot.values
        write_report(final, run.out_dir)
        html = run.out_dir / "contradictions.html"
        write_contradiction_map(final["contradictions"], final["findings"], html)
        with _lock:
            events = list(run.events)
        _emit(run, [make_event("contradictions", {"count": len(final["contradictions"]), **_review_health(final, events)})])
        with _lock:
            run.state = final
        _emit(run, [make_event("report_ready", {})])
        _finish(run, final["status"], {"stop_reason": final["stop_reason"], "rounds": final["round_no"]})
    except Exception as exc:  # a run-level failure is reported as events, never as a crash
        _emit(run, [make_event("error", {"message": f"Run failed: {type(exc).__name__}: {str(exc)[:300]}"})])
        _finish(run, "failed", {"stop_reason": "error"})
    finally:
        live.unregister(run.id)


# ---------------------------------------------------------------- demo switch

DEMO_FAIL_SUBQUESTION = int(os.getenv("APOLLO_DEMO_FAIL_SUBQUESTION", "0") or 0)


def _demo_search(query: str, errors: list[str]) -> list[dict]:
    """Athena's search, except the demo switch's target sub-question fails like a real outage."""
    with _lock:
        targeted = any(
            r.fail_subquestion and len(r.plan) >= r.fail_subquestion and query == r.plan[r.fail_subquestion - 1]
            for r in _runs.values()
            if r.status in ACTIVE
        )
    if targeted:
        errors.append(f"search[demo] simulated outage (demo switch APOLLO_DEMO_FAIL_SUBQUESTION) for {query!r}")
        return []
    return _real_search(query, errors)


_real_search = nodes.web_search


def _metered_search(query: str, errors: list[str]) -> list[dict]:
    """Athena's search, timed and recorded in the usage meter (one record per query)."""
    before, started = len(errors), time.monotonic()
    results = (_demo_search if DEMO_FAIL_SUBQUESTION else _real_search)(query, errors)
    new_errors = [e for e in errors[before:] if e.startswith("search[")]
    metering.record("search", bool(results) or not new_errors, time.monotonic() - started,
                    query=query, results=len(results), error=new_errors[-1][:200] if new_errors else "")
    # Show the raw hits now; pages are read and numbered [S#] only when the whole search step ends.
    live.publish("search_results", {"query": query, "results": [
        {"title": r.get("title", ""), "url": r.get("url", "")} for r in results if r.get("url")
    ]})
    return results


nodes.web_search = _metered_search
_load_saved()


# ---------------------------------------------------------------- endpoints


class RunRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=300)
    max_rounds: int = Field(default=2, ge=1, le=MAX_ROUNDS_LIMIT)
    hitl: bool = False


class ResumeRequest(BaseModel):
    action: Literal["approve", "edit", "reject", "skip"]
    payload: dict | None = None


class RegisterRequest(BaseModel):
    name: str = Field(max_length=80)
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


def _signed_in(user: dict, status: int = 200) -> JSONResponse:
    """Response carrying the user and a fresh session cookie (HttpOnly: page scripts cannot read it)."""
    resp = JSONResponse({"user": user}, status_code=status)
    resp.set_cookie(SESSION_COOKIE, auth.create_token(user), max_age=config.JWT_TTL_HOURS * 3600,
                    httponly=True, samesite="strict", secure=config.COOKIE_SECURE, path="/")
    return resp


def _auth_call(fn, *args) -> dict:
    try:
        return fn(*args)
    except auth.AuthError as exc:
        raise HTTPException(exc.status, exc.message) from None


@app.post("/api/auth/register")
def register(req: RegisterRequest) -> JSONResponse:
    return _signed_in(_auth_call(auth.register, req.name, req.email, req.password), status=201)


@app.post("/api/auth/login")
def login(req: LoginRequest) -> JSONResponse:
    return _signed_in(_auth_call(auth.login, req.email, req.password))


@app.post("/api/auth/logout")
def logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@app.get("/api/auth/me")
def me(user: User) -> dict:
    return {"user": user}


@app.post("/api/runs")
def start_run(req: RunRequest, user: User) -> dict:
    passages.clear_cache()  # bounded memory; each run re-embeds its own sources
    if config.EMBED_WARM_UP:
        embed.warm_up()  # load the model while the run plans and searches, not when verification starts
    run = Run(req.topic.strip(), req.max_rounds, req.hitl, owner=user["id"])
    if DEMO_FAIL_SUBQUESTION and any(t["id"] == "B" and t["topic"] == run.topic for t in _demo_topics()):
        run.fail_subquestion = DEMO_FAIL_SUBQUESTION
    with _lock:
        _runs[run.id] = run
    threading.Thread(target=_execute, args=(run,), daemon=True, name=f"run-{run.id[:8]}").start()
    return {"run_id": run.id}


@app.get("/api/runs/{run_id}")
def run_status(run_id: str, user: User) -> dict:
    run = _get(run_id, user)
    with _lock:
        return {"run_id": run.id, "topic": run.topic, "status": run.status, "pending": run.pending, "events": len(run.events)}


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, request: Request, user: User) -> StreamingResponse:
    run = _get(run_id, user)
    # Continue after the last event the client saw: EventSource sends it as a header when it reconnects by
    # itself; the web app reconnects with ?last_event_id= after the backend was briefly unreachable.
    try:
        start = int(request.headers.get("last-event-id") or request.query_params.get("last_event_id") or "-1") + 1
    except ValueError:
        start = 0

    async def stream():
        i, last_sent = start, time.monotonic()
        while True:
            if await request.is_disconnected():
                return
            with _lock:
                batch, finished = run.events[i:], run.status not in ACTIVE
            for event in batch:
                yield f"id: {i}\ndata: {json.dumps(event)}\n\n"
                i += 1
            if batch:
                last_sent = time.monotonic()
            elif finished:
                return  # all events, including "complete", have been sent
            elif time.monotonic() - last_sent >= HEARTBEAT_SECONDS:
                # A named "ping" event (not an SSE comment, which page scripts never see): the web app
                # treats a long silence as a dead connection and reconnects. It carries no id, so it
                # does not move the resume position, and it is not a run event.
                yield "event: ping\ndata: {}\n\n"
                last_sent = time.monotonic()
            await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/runs/{run_id}/resume")
def resume_run(run_id: str, req: ResumeRequest, user: User) -> dict:
    """Answer a pending interrupt.

    Plan:  approve (payload {sub_questions} = approve with edits) | edit (same payload) | reject
    Gaps:  approve (payload {gaps} = approve edited gaps) | edit (same payload) | skip | reject (= skip)
    """
    run = _get(run_id, user)
    with _lock:
        pending = run.pending
        if pending is None:
            raise HTTPException(409, "this run is not waiting for a decision")
        is_plan = pending["type"] == "approve_plan"
        body = req.payload or {}
        key = "sub_questions" if is_plan else "gaps"
        raw = body.get(key, body.get("plan") if is_plan else None)  # "plan" kept for older clients
        edited = [x.strip() for x in raw if isinstance(x, str) and x.strip()] if isinstance(raw, list) else []
        if req.action in ("approve", "edit") and raw is not None and not edited:
            raise HTTPException(422, f"payload.{key} must be a non-empty list of strings")
        if req.action == "edit" and not edited:
            raise HTTPException(422, f"edit needs payload.{key}: a non-empty list of strings")
        if req.action in ("approve", "edit"):
            answer: object = ({"plan": edited} if is_plan else {"gaps": edited}) if edited else {"approved": True}
        elif is_plan:
            if req.action == "skip":
                raise HTTPException(422, "a plan can be approved, edited, or rejected, not skipped")
            answer = _REJECT
        else:  # reject or skip on gap queries: continue without them
            answer = {"skip": True}
        run.pending = None  # a second click cannot answer the same interrupt twice
    run.answers.put(answer)
    return {"ok": True}


def _source_rows(state: dict) -> list[dict]:
    """Sources with section and, per source, how the claims citing it were verified."""
    rows = []
    for f in state["findings"]:
        statuses = [c["status"] for c in state["claims"] if f["id"] in c["source_ids"]]
        rows.append({
            "id": f["id"],
            "title": f["title"],
            "url": f["url"],
            "snippet": " ".join(f["snippet"].split())[:300],
            "section": f["section"] + 1,
            "question": state["plan"][f["section"]] if f["section"] < len(state["plan"]) else "",
            "extracted_by": f["extracted_by"] or "snippet only",
            "cited": f["id"] in set(find_citations(state["report"])),
            "claims": {s: statuses.count(s) for s in ("verified", "partial", "not_found", "unchecked") if s in statuses},
        })
    return rows


@app.get("/api/runs/{run_id}/report")
def get_report(run_id: str, user: User) -> dict:
    run = _get(run_id, user)
    with _lock:
        state, events = run.state, list(run.events)
    if state is None:
        raise HTTPException(409, "the report is not ready yet")
    return {
        "topic": state["topic"],
        "status": state["status"],
        "stop_reason": state["stop_reason"],
        "markdown": state["report"],
        "references": state["references"],
        "sources": _source_rows(state),
        "verification": [
            {"claim": c["claim"], "status": c["status"], "evidence": c["best_match"] or c["evidence"], "source_ids": c["source_ids"],
             "similarity": round(c["similarity"], 3)}
            for c in state["claims"]
        ],
        "contradictions": state["contradictions"],
        "contradictions_html_path": f"/api/runs/{run_id}/contradictions" if state["contradictions"] else None,
        "plan": state["plan"],
        "rounds": state["round_no"],
        "errors": state["errors"],
        "sections": [
            {"index": s["index"] + 1, "question": s["question"], "citations": len(find_citations(s["text"])),
             "not_found": NOT_FOUND in s["text"].lower(), "write_failed": s["text"] == WRITE_FAILED,
             "source_ids": s["source_ids"]}
            for s in sorted(state["sections"], key=lambda s: s["index"])
        ],
        "citation_check": _citation_check(state),
        "review_health": _review_health(state, events),
    }


def _citation_check(state: dict) -> dict:
    """Does every [S#] in the report point at a retrieved source? (same rule as scripts/check_citations.py)"""
    known = {f["id"] for f in state["findings"]}
    cited = find_citations(state["report"])
    return {
        "citations": len(CITE.findall(state["report"])),  # every inline occurrence
        "unique_cited": len(set(cited)),
        "dangling": sorted(set(cited) - known),
        "uncited_sources": len(known - set(cited)),
        "sources": len(known),
    }


@app.get("/api/runs/{run_id}/report.md")
def download_report(run_id: str, user: User) -> Response:
    run = _get(run_id, user)
    with _lock:
        state = run.state
    if state is None:
        raise HTTPException(409, "the report is not ready yet")
    # Rendered from the stored state, so it works after a redeploy with no local files.
    return Response(render_markdown(state), media_type="text/markdown",
                    headers={"Content-Disposition": f'attachment; filename="apollo-report-{run_id[:8]}.md"'})


@app.get("/api/runs/{run_id}/contradictions")
def contradictions_html(run_id: str, user: User) -> HTMLResponse:
    run = _get(run_id, user)
    path = run.out_dir / "contradictions.html"
    with _lock:
        state = run.state
    if state is not None:  # rebuild, so maps saved by older versions get the current layout too
        write_contradiction_map(state["contradictions"], state["findings"], path)
    if not path.exists():
        raise HTTPException(409, "the contradiction map is not ready yet")
    return HTMLResponse(path.read_text(encoding="utf-8"))


def _summary(run: Run) -> dict:
    """One row of the run list: identity, timing and the headline counts."""
    with _lock:
        state, events, status = run.state, list(run.events), run.status
    claims = {k: 0 for k in ("verified", "partial", "not_found", "unchecked")}
    for c in (state or {}).get("claims", []):
        claims[c["status"]] = claims.get(c["status"], 0) + 1
    done = next((e["data"] for e in events if e["type"] == "complete"), {})
    return {
        "run_id": run.id, "topic": run.topic, "status": status, "hitl": run.hitl, "max_rounds": run.max_rounds,
        "created_at": run.created_at, "finished_at": run.finished_at,
        "rounds": state["round_no"] if state else max((e["data"].get("round", 0) for e in events if e["type"] == "search_started"), default=0),
        "stop_reason": state["stop_reason"] if state else done.get("stop_reason"),
        "sources": len(state["findings"]) if state else sum(e["data"].get("result_count", 0) for e in events if e["type"] == "search_done"),
        "claims": claims,
        "contradictions": len(state["contradictions"]) if state else 0,
        **_review_health(state, events),
        "has_report": state is not None,
        "usage": metering.summary(metering.calls(run.id)),
    }


@app.get("/api/runs")
def list_runs(user: User) -> list[dict]:
    with _lock:
        runs = [r for r in _runs.values() if _visible(r, user)]
    return sorted((_summary(r) for r in runs), key=lambda r: r["created_at"], reverse=True)


# Events are emitted when a graph node FINISHES, so each one closes the stage it names.
STAGE_ENDED_BY = {"plan": "planning", "search_done": "searching", "search_failed": "searching", "review": "reviewing",
                  "section_written": "writing", "verification": "verifying", "contradictions": "finishing",
                  "report_ready": "finishing"}


def _stages(events: list[dict], start_ms: int) -> list[dict]:
    """Wall-clock time per stage from the event timestamps. A human pause is its own stage."""
    out: list[dict] = []
    prev, waiting = start_ms, False
    for e in events:
        kind = e["type"]
        if waiting and (kind in STAGE_ENDED_BY or kind == "search_started"):
            name, waiting = "waiting for you", False  # the first event after a pause ends the pause
        elif kind == "gaps_pending":
            name, waiting = "reviewing", True
        else:
            name = STAGE_ENDED_BY.get(kind)
            if name is None:
                continue  # e.g. search_started: its time counts towards the search it starts
            waiting = kind == "plan" and bool(e["data"].get("awaiting_approval"))
        if out and out[-1]["stage"] == name:
            out[-1]["ms"] += e["ts"] - prev
        else:
            out.append({"stage": name, "start": prev, "ms": e["ts"] - prev})
        prev = e["ts"]
    return out


def _price(provider: str) -> tuple[float, float] | None:
    """USD per 1M (input, output) tokens from .env (PRICE_<PROVIDER>_INPUT_PER_M / _OUTPUT_PER_M), or None."""
    try:
        return (float(os.getenv(f"PRICE_{provider.upper()}_INPUT_PER_M", "")),
                float(os.getenv(f"PRICE_{provider.upper()}_OUTPUT_PER_M", "")))
    except ValueError:
        return None


@app.get("/api/runs/{run_id}/metrics")
def run_metrics(run_id: str, user: User) -> dict:
    run = _get(run_id, user)
    with _lock:
        events = list(run.events)
    calls = metering.calls(run.id)
    by_node: dict[str, dict] = {}
    by_model: dict[str, dict] = {}
    for c in calls:
        model = f'{c.get("provider", "")}:{c.get("model", "")}' if c["kind"] == "llm" else "web search"
        for key, table in ((c["node"] or "(outside graph)", by_node), (model, by_model)):
            row = table.setdefault(key, {"name": key, "calls": 0, "failed": 0, "seconds": 0.0, "prompt_tokens": 0, "completion_tokens": 0})
            row["calls"] += 1
            row["failed"] += not c["ok"]
            row["seconds"] = round(row["seconds"] + c["seconds"], 3)
            row["prompt_tokens"] += c.get("prompt_tokens") or 0
            row["completion_tokens"] += c.get("completion_tokens") or 0
    cost, priced = 0.0, True
    for row in by_model.values():
        if row["name"] == "web search":
            continue
        price = _price(row["name"].split(":", 1)[0])
        if price is None:
            priced = False
            continue
        row["cost_usd"] = round(row["prompt_tokens"] / 1e6 * price[0] + row["completion_tokens"] / 1e6 * price[1], 6)
        cost += row["cost_usd"]
    return {
        "summary": metering.summary(calls),
        "by_node": sorted(by_node.values(), key=lambda r: -r["seconds"]),
        "by_model": sorted(by_model.values(), key=lambda r: -r["calls"]),
        "calls": calls,
        "stages": _stages(events, run.created_at),
        "cost_usd": round(cost, 6) if priced and any(r["name"] != "web search" for r in by_model.values()) else None,
        "wall_ms": (run.finished_at or int(time.time() * 1000)) - run.created_at,
    }


# Strings that look like real keys. A hit is reported masked (first 6 characters only).
KEY_PATTERNS = [
    ("Groq key", re.compile(r"gsk_[A-Za-z0-9]{20,}")),
    ("Tavily key", re.compile(r"tvly-[A-Za-z0-9-]{16,}")),
    ("Google key", re.compile(r"AIza[0-9A-Za-z_-]{30,}")),
    ("Key assignment", re.compile(r"(?i)\b\w*API_KEY\w*\s*[:=]\s*[\"'][^\"'\s]{16,}[\"']")),
]
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf"}


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(["git", *args], cwd=Path(__file__).parent, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout if out.returncode == 0 else None


def _secret_scan() -> dict:
    """Scan git-tracked files for strings that look like API keys."""
    tracked = _git("ls-files")
    if tracked is None:
        return {"ran": False, "files": 0, "findings": []}
    root, findings, files = Path(__file__).parent, [], 0
    for name in tracked.splitlines():
        if Path(name).suffix.lower() in SKIP_SUFFIXES or name.endswith("package-lock.json"):
            continue
        try:
            text = (root / name).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        files += 1
        for no, line in enumerate(text.splitlines(), 1):
            for kind, pattern in KEY_PATTERNS:
                m = pattern.search(line)
                if m:
                    findings.append({"file": name, "line": no, "kind": kind, "match": m.group(0)[:6] + "…"})
    return {"ran": True, "files": files, "findings": findings[:50]}


@app.get("/api/system")
def system(user: User) -> dict:
    """Configuration and security posture. Keys are reported as present/absent, never as values."""
    root = Path(__file__).parent
    ignore = root / ".gitignore"
    ignored = [g.strip() for g in ignore.read_text(encoding="utf-8").splitlines()] if ignore.exists() else []
    tracked_env = _git("ls-files", ".env")
    return {
        "keys": {name: bool(getattr(config, name)) for name in ("TAVILY_API_KEY", "SERPER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY")},
        "llm": {"provider": config.LLM_PROVIDER, "groq_model": config.GROQ_MODEL, "gemini_model": config.GEMINI_MODEL,
                "verify_chain": [f"{p}:{m}" for p, m in config.VERIFY_CHAIN]},
        "limits": {"max_rounds": MAX_ROUNDS_LIMIT, "timeout_seconds": config.TIMEOUT_SECONDS,
                   "search_max_retries": config.SEARCH_MAX_RETRIES, "llm_max_retries": config.LLM_MAX_RETRIES,
                   "request_timeout_seconds": config.REQUEST_TIMEOUT_SECONDS, "recursion_limit": config.GRAPH_RECURSION_LIMIT,
                   "max_gap_queries": config.MAX_GAP_QUERIES, "verify_max_claims": config.VERIFY_MAX_CLAIMS,
                   "hitl_wait_seconds": HITL_WAIT_SECONDS, "max_page_bytes": config.MAX_PAGE_BYTES},
        "checks": {
            "env_example_committed": (root / ".env.example").exists(),
            "env_gitignored": ".env" in ignored,
            "env_tracked_by_git": None if tracked_env is None else bool(tracked_env.strip()),
            "cors_origins": VITE_ORIGINS,
            "demo_switch": DEMO_FAIL_SUBQUESTION,
            "database": db.kind(),  # "postgres" or "sqlite"; the URL (with its password) is never sent
        },
        "secret_scan": _secret_scan(),
    }


@app.get("/api/demo-topics")
def demo_topics(user: User) -> list[dict]:
    return _demo_topics()


def _demo_topics() -> list[dict]:
    """Parse demo/topics.md. Each `## Topic <id>: <title>` section gives one topic: its
    `**Topic:**` line is the topic, its `Settings:` line (if any) is the note."""
    text = DEMO_TOPICS_FILE.read_text(encoding="utf-8")
    out = []
    for m in re.finditer(r"^## Topic (\w+)(?::\s*(.*))?\n((?:(?!^## ).*\n?)*)", text, re.M):
        body = m.group(3)
        topic = re.search(r"^\*\*Topic:\*\*\s*(.+)$", body, re.M)
        if not topic:
            continue
        note = re.search(r"^Settings:\s*(.+)$", body, re.M)
        title = (m.group(2) or f"Topic {m.group(1)}").strip()
        out.append({
            "id": m.group(1),
            "title": title[:1].upper() + title[1:],
            "topic": topic.group(1).strip().strip("`"),
            "note": re.sub(r"[*`]", "", note.group(1)).strip() if note else None,
        })
    return out


@app.post("/api/cache/clear")
def clear_cache(user: User) -> dict:
    """Start demos clean: drop cached embeddings and the caller's finished runs (and their output files)."""
    passages.clear_cache()
    with _lock:
        done = [rid for rid, r in _runs.items() if r.status not in ACTIVE and r.owner == user["id"]]
        for rid in done:
            del _runs[rid]
            metering.forget(rid)
    removed = 0
    if done:
        with db.engine().begin() as conn:
            conn.execute(delete(db.runs).where(db.runs.c.id.in_(done)))
    for rid in done:
        d = RUNS_DIR / rid
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    return {"runs_forgotten": len(done), "output_dirs_removed": removed}


# ---------------------------------------------------------------- production frontend

# In production (Dockerfile) the built React app is served by this same server, so the UI and /api share one
# origin, which the SameSite=Strict login cookie requires. Mounted last, so every /api route above wins.
# In local development frontend/dist is ignored by the Vite dev server on :5173, which proxies /api here.
_FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
