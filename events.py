"""Turn LangGraph stream updates into the small, typed events the web UI shows.

The frontend never sees raw graph state: api.py feeds every
`graph.stream(..., stream_mode="updates")` chunk through EventConverter and
sends only the events below (each is {"type", "data", "ts"}).

  plan             Apollo's plan: data.pending=True while waiting for human approval
  search_started   a research round begins: round, queries
  search_done      one query finished: query, new_sources, sources [{id, title, url}]
  search_failed    one query returned nothing usable: query, reason
  review           Hermes' verdict (complete, gaps, contradictions), a human gap
                   decision, or Apollo's stop decision (stop_reason)
  gaps_pending     waiting for human approval of Hermes' gap queries
  section_written  one report section done: index, question, citations, not_found
  verification     claim counts by status
  contradictions   number of conflicts and the URL of the map (or null)
  report_ready     the report can be fetched
  error            warnings (fatal=False, e.g. a page could not be read) or a
                   run failure (fatal=True). Shown as amber warnings, never stack traces.
  complete         the run ended: status, stop_reason

Nodes return their FULL `findings` / `errors` lists, so the converter remembers
how many it has already reported and only turns the new items into events.
"""

from datetime import datetime, timezone

from tools.text import NOT_FOUND, find_citations


def make_event(type_: str, data: dict) -> dict:
    return {"type": type_, "data": data, "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds")}


class EventConverter:
    def __init__(self) -> None:
        self.n_findings = 0
        self.n_errors = 0
        self.n_searched = 0
        self.round = 1
        self.failed_queries: set[str] = set()

    # ------------------------------------------------------------ public

    def from_update(self, node: str, update: dict | None) -> list[dict]:
        """Events for one node's update (a dict of the state keys it changed, or None)."""
        if not update:
            return []
        handler = getattr(self, f"_{node}", None)
        events = handler(update) if handler else []
        return events + self._warnings(node, update)

    def from_interrupt(self, payload: dict) -> list[dict]:
        if payload.get("type") == "approve_plan":
            return [make_event("plan", {"plan": payload["plan"], "pending": True})]
        if payload.get("type") == "approve_gaps":
            return [make_event("gaps_pending", {"round": payload["round"], "gaps": payload["gaps"]})]
        return []

    # ------------------------------------------------------------ per node

    def _apollo_plan(self, u: dict) -> list[dict]:
        return [make_event("plan", {"plan": u["plan"], "pending": False, "approved": False})]

    def _review_plan(self, u: dict) -> list[dict]:
        queries = [q["query"] for q in u.get("pending_queries", [])]
        return [
            make_event("plan", {"plan": u["plan"], "pending": False, "approved": True}),
            make_event("search_started", {"round": 1, "queries": queries}),
        ]

    def _athena_search(self, u: dict) -> list[dict]:
        findings = u.get("findings", [])
        new = findings[self.n_findings :]
        self.n_findings = len(findings)
        searched = u.get("searched_queries", [])
        queries = searched[self.n_searched :]  # the queries Athena attempted this round
        self.n_searched = len(searched)
        new_errors = u.get("errors", [])[self.n_errors :]
        self.failed_queries = set()
        events = []
        for q in queries:
            got = [f for f in new if f["query"] == q]
            search_errs = [e for e in new_errors if e.startswith("search[") and repr(q) in e]
            if got:
                events.append(
                    make_event(
                        "search_done",
                        {
                            "round": self.round,
                            "query": q,
                            "new_sources": len(got),
                            "sources": [{"id": f["id"], "title": f["title"], "url": f["url"]} for f in got],
                        },
                    )
                )
            elif search_errs:
                self.failed_queries.add(q)
                events.append(make_event("search_failed", {"round": self.round, "query": q, "reason": search_errs[-1]}))
            else:  # results came back, but every page was already collected earlier
                events.append(make_event("search_done", {"round": self.round, "query": q, "new_sources": 0, "sources": []}))
        return events

    def _hermes_review(self, u: dict) -> list[dict]:
        return [
            make_event(
                "review",
                {
                    "round": self.round,
                    "complete": u.get("hermes_complete", False),
                    "gaps": [g["query"] for g in u.get("gaps", [])],
                    "contradictions": len(u.get("contradictions", [])),
                },
            )
        ]

    def _review_gaps(self, u: dict) -> list[dict]:
        if u.get("gaps_skipped"):
            decision, gaps = "skipped", []
        elif "gaps" in u:
            decision, gaps = "edited", [g["query"] for g in u["gaps"]]
        else:
            decision, gaps = "approved", None
        return [make_event("review", {"round": self.round, "gaps_decision": decision, "gaps": gaps})]

    def _decide(self, u: dict) -> list[dict]:
        if "round_no" in u:
            self.round = u["round_no"]
            queries = [q["query"] for q in u.get("pending_queries", [])]
            return [make_event("search_started", {"round": self.round, "queries": queries})]
        return [make_event("review", {"round": self.round, "stop_reason": u.get("stop_reason", ""), "status": u.get("status")})]

    def _write_section(self, u: dict) -> list[dict]:
        events = []
        for s in u.get("sections", []):
            events.append(
                make_event(
                    "section_written",
                    {
                        "index": s["index"],
                        "question": s["question"],
                        "citations": len(find_citations(s["text"])),
                        "not_found": NOT_FOUND in s["text"].lower(),
                    },
                )
            )
        return events

    def _verify_claims(self, u: dict) -> list[dict]:
        counts = {k: 0 for k in ("verified", "partial", "not_found", "unchecked")}
        for c in u.get("claims", []):
            counts[c["status"]] = counts.get(c["status"], 0) + 1
        return [make_event("verification", {"total": len(u.get("claims", [])), "counts": counts})]

    # ------------------------------------------------------------ helpers

    def _warnings(self, node: str, u: dict) -> list[dict]:
        """New non-fatal errors as ONE amber warning event per node update.

        Search errors for queries already reported as search_failed are left out (shown once).
        """
        if "errors" not in u:
            return []
        new = u["errors"][self.n_errors :]
        self.n_errors = len(u["errors"])
        if node == "athena_search":
            new = [e for e in new if not (e.startswith("search[") and any(repr(q) in e for q in self.failed_queries))]
        if not new:
            return []
        return [make_event("error", {"fatal": False, "node": node, "count": len(new), "messages": new})]
