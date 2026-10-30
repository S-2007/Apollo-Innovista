"""State schema shared by every node in the Apollo LangGraph.

LangGraph passes one dict of this shape between nodes. Each node returns only
the keys it changed; list fields are returned as full new lists, EXCEPT
`sections`, which has an add-reducer because write_section runs in parallel
(one task per plan section) and each task appends its own section.
"""

import operator
from typing import Annotated, Literal, TypedDict


class Finding(TypedDict):
    id: str        # stable citation id: "S1", "S2", ...
    section: int   # index into plan: which sub-question this source was collected for
    query: str     # the query that retrieved it
    title: str
    url: str
    snippet: str   # short text from the search API
    content: str   # extracted page text (capped), "" if extraction failed
    extracted_by: str  # "trafilatura" | "tavily_raw" | "" (none)


class Query(TypedDict):
    query: str
    section: int


class Contradiction(TypedDict):
    source_a: str  # finding id, e.g. "S2"
    source_b: str  # finding id, e.g. "S5"
    claim: str


class Section(TypedDict):
    index: int
    question: str
    text: str             # paragraph with [S#] citations, or "Not found in sources."
    source_ids: list[str]  # ids that were given to the writer
    errors: list[str]     # merged into state["errors"] by assemble


class Reference(TypedDict):
    id: str
    title: str
    url: str


class ClaimCheck(TypedDict):
    claim: str
    source_ids: list[str]
    status: Literal["verified", "partial", "not_found", "unchecked"]
    best_match: str       # best-matching sentence from the retrieved source text
    similarity: float
    evidence: str         # the LLM's quoted evidence


class ResearchState(TypedDict):
    # Required fields
    topic: str
    plan: list[str]                       # Apollo's sub-questions
    round_no: int                         # current research round (1-based)
    max_rounds: int
    findings: list[Finding]
    gaps: list[Query]                     # Hermes' follow-up queries from the last review
    contradictions: list[Contradiction]
    status: Literal["running", "complete", "failed"]
    events: list[str]                     # human-readable progress log
    errors: list[str]                     # non-fatal errors (failed searches, bad JSON, ...)

    # Loop-control bookkeeping
    pending_queries: list[Query]          # queries Athena runs in the current round
    searched_queries: list[str]           # every query already run (avoid repeats)
    hermes_complete: bool                 # Hermes' last verdict
    started_at: float                     # research clock start (shifted forward by human pauses)
    paused_at: float                      # when the last possible human pause began
    timeout_seconds: int
    stop_reason: str                      # why the loop ended (set by decide)

    # Human-in-the-loop
    auto_approve: bool                    # True: never pause
    review_gaps: bool                     # when not auto_approve: also pause to approve gap queries
    gaps_skipped: bool                    # the human skipped the gap queries

    # Writing and verification (Phase 2)
    sections: Annotated[list[Section], operator.add]
    report: str                           # Markdown body: title, intro, sections, conclusion
    references: list[Reference]           # only ids actually cited in `report`
    claims: list[ClaimCheck]


def initial_state(
    topic: str,
    max_rounds: int,
    timeout_seconds: int,
    started_at: float,
    auto_approve: bool = True,
    review_gaps: bool = True,
) -> ResearchState:
    return ResearchState(
        topic=topic,
        plan=[],
        round_no=1,
        max_rounds=max_rounds,
        findings=[],
        gaps=[],
        contradictions=[],
        status="running",
        events=[],
        errors=[],
        pending_queries=[],
        searched_queries=[],
        hermes_complete=False,
        started_at=started_at,
        paused_at=started_at,
        timeout_seconds=timeout_seconds,
        stop_reason="",
        auto_approve=auto_approve,
        review_gaps=review_gaps,
        gaps_skipped=False,
        sections=[],
        report="",
        references=[],
        claims=[],
    )
