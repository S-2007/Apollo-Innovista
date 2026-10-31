"""Phase 3 tests: the FastAPI layer and event conversion, fully offline.

The graph itself is the frozen Phase 1-2 code; search, extraction, the LLM and
the embedding model are fakes (tests/fakes.py), so a whole run takes well under
a second and these tests check the API's behaviour, not external services.
"""

import json
import time

import pytest
from fastapi.testclient import TestClient

import api
from graph import nodes
from tools import passages as passages_mod
from verify import claims as claims_mod

from .fakes import PLAN, fake_embed, fake_llm, fake_search

COMPLETE = lambda n: '{"complete": true, "gaps": []}'
GAPS = lambda n: json.dumps({"complete": False, "gaps": [{"section": 1, "query": f"gap query {n}"}]})


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    monkeypatch.setattr(nodes, "web_search", fake_search())
    monkeypatch.setattr(nodes, "page_content", lambda url, raw, errors: (f"Page text for {url}. It reports a finding.", "trafilatura"))
    monkeypatch.setattr(nodes, "llm_chat", fake_llm(COMPLETE))
    monkeypatch.setattr(passages_mod, "embed", fake_embed)
    monkeypatch.setattr(claims_mod, "embed", fake_embed)
    monkeypatch.setattr(claims_mod, "llm_chat", lambda *a, **k: '{"supported": true, "evidence": "x"}')
    monkeypatch.setattr(claims_mod, "_available_chain", lambda: [("groq", "m")])
    monkeypatch.setattr(api, "RUNS_DIR", tmp_path / "runs")
    api._runs.clear()


@pytest.fixture
def client():
    return TestClient(api.app)


def _wait(client, run_id, predicate, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        status = client.get(f"/api/runs/{run_id}").json()
        if predicate(status):
            return status
        time.sleep(0.05)
    raise AssertionError(f"timed out; last status {status}")


def _sse_events(client, run_id):
    """Read the SSE stream to the end and return the decoded events."""
    events = []
    with client.stream("GET", f"/api/runs/{run_id}/events") as resp:
        assert resp.headers["content-type"].startswith("text/event-stream")
        for line in resp.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def _start(client, **body):
    resp = client.post("/api/runs", json={"topic": "drones in farming", **body})
    assert resp.status_code == 200, resp.text
    return resp.json()["run_id"]


def test_run_streams_ordered_events_and_serves_report(client):
    run_id = _start(client, max_rounds=2)
    events = _sse_events(client, run_id)
    types = [e["type"] for e in events]

    assert types[0] == "plan" and types[-1] == "complete"
    assert types.index("search_started") < types.index("search_done") < types.index("review")
    assert types.index("review") < types.index("section_written") < types.index("verification")
    assert types[-3:] == ["contradictions", "report_ready", "complete"]
    assert types.count("section_written") == len(PLAN)
    assert all({"type", "data", "ts"} <= e.keys() for e in events)
    assert events[-1]["data"]["status"] == "complete"

    report = client.get(f"/api/runs/{run_id}/report").json()
    assert report["markdown"].startswith("# drones in farming")
    assert {s["id"] for s in report["sources"]} >= {r["id"] for r in report["references"]}
    assert report["contradictions_html_path"] is None
    md = client.get(f"/api/runs/{run_id}/report.md")
    assert md.status_code == 200 and "## References" in md.text
    assert "attachment" in md.headers["content-disposition"]


def test_failed_search_becomes_search_failed_event_and_run_completes(client, monkeypatch):
    def search(query, errors):
        if query == "q two":
            errors.append(f"search[tavily] returned no results for {query!r}")
            return []
        return fake_search()(query, errors)

    monkeypatch.setattr(nodes, "web_search", search)
    events = _sse_events(client, _start(client))
    failed = [e for e in events if e["type"] == "search_failed"]
    assert [e["data"]["query"] for e in failed] == ["q two"]
    assert events[-1]["data"]["status"] == "complete"
    assert any(e["type"] == "section_written" and e["data"]["not_found"] for e in events)


def test_hitl_edit_plan_then_skip_gaps(client, monkeypatch):
    monkeypatch.setattr(nodes, "llm_chat", fake_llm(GAPS))
    run_id = _start(client, hitl=True)

    status = _wait(client, run_id, lambda s: s["status"] == "awaiting_input")
    assert status["pending"]["type"] == "approve_plan"
    edited = ["edited question one", "q two"]
    assert client.post(f"/api/runs/{run_id}/resume", json={"action": "edit", "payload": {"plan": edited}}).json() == {"ok": True}

    status = _wait(client, run_id, lambda s: s["status"] == "awaiting_input")
    assert status["pending"]["type"] == "approve_gaps"
    client.post(f"/api/runs/{run_id}/resume", json={"action": "skip"})
    _wait(client, run_id, lambda s: s["status"] not in api.ACTIVE)

    events = _sse_events(client, run_id)  # full replay of the finished run
    started = [e for e in events if e["type"] == "search_started"]
    assert started[0]["data"]["queries"] == edited
    assert any(e["type"] == "gaps_pending" for e in events)
    assert any(e["type"] == "review" and e["data"].get("gaps_decision") == "skipped" for e in events)
    assert events[-1]["data"]["stop_reason"] == "gaps_skipped_by_user"


def test_reject_plan_cancels_run(client):
    run_id = _start(client, hitl=True)
    _wait(client, run_id, lambda s: s["status"] == "awaiting_input")
    client.post(f"/api/runs/{run_id}/resume", json={"action": "reject"})
    status = _wait(client, run_id, lambda s: s["status"] not in api.ACTIVE)
    assert status["status"] == "rejected"
    assert client.get(f"/api/runs/{run_id}/report").status_code == 409


def test_graph_exception_becomes_error_event_not_500(client, monkeypatch):
    def broken(state):
        raise RuntimeError("search backend exploded")

    monkeypatch.setattr(nodes, "athena_search", broken)
    run_id = _start(client)
    events = _sse_events(client, run_id)
    fatal = [e for e in events if e["type"] == "error" and e["data"]["fatal"]]
    assert fatal and "search backend exploded" in fatal[0]["data"]["messages"][0]
    assert "Traceback" not in json.dumps(events)
    assert events[-1] == {**events[-1], "type": "complete"} and events[-1]["data"]["status"] == "failed"
    assert client.get(f"/api/runs/{run_id}/report").status_code == 409


def test_request_validation(client):
    assert client.post("/api/runs", json={"topic": "x" * 10, "max_rounds": 3}).status_code == 422  # hard limit is 2
    assert client.post("/api/runs", json={"topic": "ab"}).status_code == 422
    assert client.get("/api/runs/nope/events").status_code == 404
    run_id = _start(client)
    _wait(client, run_id, lambda s: s["status"] not in api.ACTIVE)
    assert client.post(f"/api/runs/{run_id}/resume", json={"action": "approve"}).status_code == 409


def test_sse_resumes_after_last_event_id(client):
    run_id = _start(client)
    _wait(client, run_id, lambda s: s["status"] not in api.ACTIVE)
    everything = _sse_events(client, run_id)
    with client.stream("GET", f"/api/runs/{run_id}/events", headers={"Last-Event-ID": "4"}) as resp:
        tail = [json.loads(line[6:]) for line in resp.iter_lines() if line.startswith("data: ")]
    assert tail == everything[5:]


def test_demo_topics_and_cache_clear(client, monkeypatch, tmp_path):
    md = tmp_path / "topics.md"
    md.write_text("# Demo\n\n## Topic A — two rounds\nSome notes.\n**Topic:** `First topic`\n\n## Topic B — failure\n**Topic:** Second topic\n", encoding="utf-8")
    monkeypatch.setattr(api, "DEMO_TOPICS_FILE", md)
    assert client.get("/api/demo-topics").json() == [
        {"label": "Topic A", "topic": "First topic"},
        {"label": "Topic B", "topic": "Second topic"},
    ]
    run_id = _start(client)
    _wait(client, run_id, lambda s: s["status"] not in api.ACTIVE)
    assert client.post("/api/cache/clear").json() == {"runs_forgotten": 1, "output_dirs_removed": 1}
    assert client.get(f"/api/runs/{run_id}").status_code == 404


def test_demo_switch_fails_only_topic_b_subquestion(client, monkeypatch, tmp_path):
    md = tmp_path / "topics.md"
    md.write_text("## Topic A\n**Topic:** topic alpha\n\n## Topic B\n**Topic:** topic bravo\n", encoding="utf-8")
    monkeypatch.setattr(api, "DEMO_TOPICS_FILE", md)
    monkeypatch.setattr(api, "DEMO_FAIL_SUBQUESTION", 2)
    monkeypatch.setattr(api, "_real_search", fake_search())
    monkeypatch.setattr(nodes, "web_search", api._demo_search)

    def run(topic):
        resp = client.post("/api/runs", json={"topic": topic, "max_rounds": 1})
        return _sse_events(client, resp.json()["run_id"])

    events_b = run("topic bravo")
    failed = [e["data"] for e in events_b if e["type"] == "search_failed"]
    assert [f["query"] for f in failed] == [PLAN[1]]
    assert "simulated outage (demo switch" in failed[0]["reason"]
    assert events_b[-1]["data"]["status"] == "complete"
    section2 = [e["data"] for e in events_b if e["type"] == "section_written" and e["data"]["index"] == 1]
    assert section2[0]["not_found"] and section2[0]["citations"] == 0

    events_a = run("topic alpha")  # any other topic is never affected
    assert not any(e["type"] == "search_failed" for e in events_a)
