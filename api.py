"""FastAPI backend for the Apollo web app (Phase 3).

Runs the frozen Phase 1-2 graph in background threads and streams its progress
to the browser as Server-Sent Events. Endpoints:

  POST /api/runs                     start a run {topic, max_rounds, hitl} -> {run_id}
  GET  /api/runs/{id}                status and any pending human decision
  GET  /api/runs/{id}/events         SSE stream of typed events (see events.py)
  POST /api/runs/{id}/resume         answer a pending interrupt {action, payload?}
  GET  /api/runs/{id}/report         report markdown, sources, verification, conflicts
  GET  /api/runs/{id}/report.md      download the exported Markdown report
  GET  /api/runs/{id}/contradictions.html   the pyvis contradiction map
  GET  /api/demo-topics              the two demo topics from demo/topics.md
  POST /api/cache/clear              forget finished runs and cached embeddings

Each run lives in an in-memory registry guarded by one lock: its event list,
status, pending interrupt, and a queue the graph thread waits on for the
human's answer. A run-level failure becomes an "error" event plus a "complete"
event with status "failed"; it never becomes an HTTP 500.

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
import os
import queue
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel, Field

import config
from events import EventConverter, make_event
from export import write_report
from graph import nodes
from graph.state import initial_state
from graph.workflow import build_graph
from tools import passages
from tools.text import find_citations
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
    def __init__(self, topic: str, max_rounds: int, hitl: bool) -> None:
        self.id = uuid.uuid4().hex
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


def _get(run_id: str) -> Run:
    with _lock:
        run = _runs.get(run_id)
    if run is None:
        raise HTTPException(404, "unknown run_id")
    return run


def _emit(run: Run, events: list[dict]) -> None:
    if events:
        with _lock:
            run.events.extend(events)


def _finish(run: Run, status: str, data: dict) -> None:
    """Append the final event and set the status together, so SSE readers see both or neither."""
    with _lock:
        run.events.append(make_event("complete", {"status": status, **data}))
        run.status = status
        run.pending = None


# ---------------------------------------------------------------- graph thread


def _execute(run: Run) -> None:
    converter = EventConverter()
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
                _emit(run, [make_event("error", {"fatal": False, "node": "human", "count": 1,
                                                 "messages": ["No answer within 15 minutes; auto-approved."]})])
            if answer is _REJECT:
                _finish(run, "rejected", {"stop_reason": "plan_rejected_by_user"})
                return
            with _lock:
                run.pending, run.status = None, "running"
            payload = Command(resume=answer)

        final = snapshot.values
        write_report(final, run.out_dir)
        html = run.out_dir / "contradictions.html"
        message = write_contradiction_map(final["contradictions"], final["findings"], html)
        n = len(final["contradictions"])
        _emit(run, [make_event("contradictions", {"count": n, "message": message,
                                                  "url": f"/api/runs/{run.id}/contradictions.html" if n else None})])
        with _lock:
            run.state = final
        _emit(run, [make_event("report_ready", {"url": f"/api/runs/{run.id}/report"})])
        _finish(run, final["status"], {"stop_reason": final["stop_reason"], "rounds": final["round_no"]})
    except Exception as exc:  # a run-level failure is reported as events, never as a crash
        _emit(run, [make_event("error", {"fatal": True, "node": "run", "count": 1,
                                         "messages": [f"Run failed: {type(exc).__name__}: {str(exc)[:300]}"]})])
        _finish(run, "failed", {"stop_reason": "error"})


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
if DEMO_FAIL_SUBQUESTION:
    nodes.web_search = _demo_search


# ---------------------------------------------------------------- endpoints


class RunRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=300)
    max_rounds: int = Field(default=2, ge=1, le=MAX_ROUNDS_LIMIT)
    hitl: bool = False


class ResumeRequest(BaseModel):
    action: Literal["approve", "edit", "reject", "skip"]
    payload: dict | None = None


@app.post("/api/runs")
def start_run(req: RunRequest) -> dict:
    passages.clear_cache()  # bounded memory; each run re-embeds its own sources
    run = Run(req.topic.strip(), req.max_rounds, req.hitl)
    if DEMO_FAIL_SUBQUESTION and any(t["label"] == "Topic B" and t["topic"] == run.topic for t in demo_topics()):
        run.fail_subquestion = DEMO_FAIL_SUBQUESTION
    with _lock:
        _runs[run.id] = run
    threading.Thread(target=_execute, args=(run,), daemon=True, name=f"run-{run.id[:8]}").start()
    return {"run_id": run.id}


@app.get("/api/runs/{run_id}")
def run_status(run_id: str) -> dict:
    run = _get(run_id)
    with _lock:
        return {"run_id": run.id, "topic": run.topic, "status": run.status, "pending": run.pending, "events": len(run.events)}


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, request: Request) -> StreamingResponse:
    run = _get(run_id)
    try:  # EventSource sends the last id it saw when it reconnects: continue after it
        start = int(request.headers.get("last-event-id", "-1")) + 1
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
                yield ": heartbeat\n\n"
                last_sent = time.monotonic()
            await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/runs/{run_id}/resume")
def resume_run(run_id: str, req: ResumeRequest) -> dict:
    run = _get(run_id)
    with _lock:
        pending = run.pending
        if pending is None:
            raise HTTPException(409, "this run is not waiting for a decision")
        kind = pending["type"]
        body = req.payload or {}
        if req.action == "approve":
            answer: object = {"approved": True}
        elif req.action == "edit":
            key = "plan" if kind == "approve_plan" else "gaps"
            items = [s.strip() for s in body.get(key, []) if isinstance(s, str) and s.strip()]
            if not items:
                raise HTTPException(422, f"edit needs payload.{key}: a non-empty list of strings")
            answer = {key: items}
        elif kind == "approve_plan":
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
def get_report(run_id: str) -> dict:
    run = _get(run_id)
    with _lock:
        state = run.state
    if state is None:
        raise HTTPException(409, "the report is not ready yet")
    return {
        "topic": state["topic"],
        "status": state["status"],
        "stop_reason": state["stop_reason"],
        "markdown": state["report"],
        "references": state["references"],
        "sources": _source_rows(state),
        "verification": state["claims"],
        "contradictions": state["contradictions"],
        "contradictions_html_path": f"/api/runs/{run_id}/contradictions.html" if state["contradictions"] else None,
    }


@app.get("/api/runs/{run_id}/report.md")
def download_report(run_id: str) -> FileResponse:
    path = _get(run_id).out_dir / "report.md"
    if not path.exists():
        raise HTTPException(409, "the report is not ready yet")
    return FileResponse(path, media_type="text/markdown", filename=f"apollo-report-{run_id[:8]}.md")


@app.get("/api/runs/{run_id}/contradictions.html")
def contradictions_html(run_id: str) -> HTMLResponse:
    path = _get(run_id).out_dir / "contradictions.html"
    if not path.exists():
        raise HTTPException(409, "the contradiction map is not ready yet")
    return HTMLResponse(path.read_text(encoding="utf-8"))


@app.get("/api/demo-topics")
def demo_topics() -> list[dict]:
    """Topics are the `**Topic:**` lines of demo/topics.md, under `## Topic A` / `## Topic B` headings."""
    text = DEMO_TOPICS_FILE.read_text(encoding="utf-8")
    out = []
    for m in re.finditer(r"^## (Topic \w+)[^\n]*\n(?:.*\n)*?\*\*Topic:\*\*\s*(.+)$", text, re.M):
        out.append({"label": m.group(1), "topic": m.group(2).strip().strip("`")})
    return out


@app.post("/api/cache/clear")
def clear_cache() -> dict:
    """Start demos clean: drop cached embeddings and every finished run (and its output files)."""
    passages.clear_cache()
    with _lock:
        done = [rid for rid, r in _runs.items() if r.status not in ACTIVE]
        for rid in done:
            del _runs[rid]
    removed = 0
    if RUNS_DIR.exists():
        for d in RUNS_DIR.iterdir():
            if d.is_dir() and d.name not in _runs:
                shutil.rmtree(d, ignore_errors=True)
                removed += 1
    return {"runs_forgotten": len(done), "output_dirs_removed": removed}
