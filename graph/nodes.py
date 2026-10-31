"""The nodes of the Apollo graph — one function per agent step.

Research loop (Phase 1):
- apollo_plan    (Apollo, manager): LLM splits the topic into 3-5 sub-questions.
- review_plan    (human): optional interrupt to approve or edit the plan.
- athena_search  (Athena, searcher): web-searches each pending query, picks the
                 top new pages and numbers them S1, S2, ... in order, tags each
                 with its plan section, then extracts page text in parallel.
- hermes_review  (Hermes, reviewer): LLM reads each finding's title plus its most
                 relevant passages (tools/passages.py) and returns
                 {"complete", "gaps", "contradictions"} as JSON.
- review_gaps    (human): optional interrupt to approve, edit, or skip the gaps.
- decide         (Apollo, manager): applies the stop rules IN CODE
                 (Hermes complete / max rounds / timeout / no gaps) and either
                 sets up the next round or finishes the loop.
- route_after_decide: next round, or fan out one write_section per section.

Writing (Phase 2):
- write_section  runs once per plan section (LangGraph Send), sees ONLY that
                 section's findings. Code then removes citations to ids it was
                 not given and sentences with no citation.
- assemble       intro + sections + conclusion, duplicate removal, and a
                 References list built from the ids actually cited.
- verify_claims  checks each cited sentence against retrieved text (verify/claims.py).

Every node catches its own failures, logs them to state["errors"], and returns
a usable state, so the graph always reaches END.
"""

import re
import time
from concurrent.futures import ThreadPoolExecutor

from langgraph.types import Send, interrupt

import config
import live
from llm import chat as llm_chat
from tools.extract import page_content
from tools.passages import relevant_passages
from tools.jsonparse import parse_json
from tools.search import search as web_search
from tools.text import (
    NOT_FOUND,
    WRITE_FAILED,
    find_citations,
    int_id,
    mark_absence,
    normalize_citations,
    normalize_not_found,
    sentence_key,
    split_sentences,
)
from verify.claims import verify_report

from .state import Query, ResearchState, Section

# ---------------------------------------------------------------- helpers


def _elapsed(state: ResearchState, now: float | None = None) -> float:
    return (now or time.time()) - state["started_at"]


def _timed_out(state: ResearchState, now: float | None = None) -> bool:
    return _elapsed(state, now) > state["timeout_seconds"]


def _norm_url(url: str) -> str:
    return url.strip().rstrip("/").split("#")[0].lower()


def _clean_str_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        if isinstance(item, str) and item.strip() and item.strip() not in out:
            out.append(item.strip())
    return out


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 3}


def _best_section(query: str, plan: list[str]) -> int:
    """Fallback section for a gap query: the sub-question sharing the most words."""
    q = _words(query)
    return max(range(len(plan)), key=lambda i: len(q & _words(plan[i])), default=0)


def _to_queries(items, plan: list[str]) -> list[Query]:
    """Accept [{"section": n, "query": "..."}] (1-based section) or plain strings."""
    out: list[Query] = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            query, section = item.strip(), None
        elif isinstance(item, dict) and isinstance(item.get("query"), str):
            query, section = item["query"].strip(), item.get("section")
        else:
            continue
        if not query or any(q["query"].lower() == query.lower() for q in out):
            continue
        idx = section - 1 if isinstance(section, int) and 1 <= section <= len(plan) else _best_section(query, plan)
        out.append({"query": query, "section": idx})
    return out


def _stop_reason(state: ResearchState, now: float | None = None) -> str | None:
    """The loop's stop rules, first match wins. None means: run another round."""
    if state["hermes_complete"]:
        return "hermes_complete"
    if state["round_no"] >= state["max_rounds"]:
        return "max_rounds_reached"
    if _timed_out(state, now):
        return "timeout"
    if state.get("gaps_skipped"):
        return "gaps_skipped_by_user"
    if not state["gaps"]:
        return "no_follow_up_queries"
    return None


# ---------------------------------------------------------------- Apollo: plan

PLAN_SYSTEM = (
    "You are Apollo, the research manager. Break the user's research topic into "
    f"{config.MIN_SUBQUESTIONS}-{config.MAX_SUBQUESTIONS} specific, searchable sub-questions "
    "that together cover the topic. Do NOT answer them. "
    'Reply with JSON only: {"sub_questions": ["...", "..."]}'
)


def _validate_plan(obj) -> list[str] | None:
    if not obj:
        return None
    qs = _clean_str_list(obj.get("sub_questions"))
    if len(qs) < config.MIN_SUBQUESTIONS:
        return None
    return qs[: config.MAX_SUBQUESTIONS]


def apollo_plan(state: ResearchState) -> dict:
    events, errors = list(state["events"]), list(state["errors"])
    topic = state["topic"]
    plan = None
    for attempt in (1, 2):  # first try + one retry
        try:
            raw = llm_chat(PLAN_SYSTEM, f"Topic: {topic}", temperature=config.PLAN_TEMPERATURE)
        except Exception as exc:
            errors.append(f"apollo_plan LLM call failed (attempt {attempt}): {type(exc).__name__}: {str(exc)[:200]}")
            continue
        plan = _validate_plan(parse_json(raw))
        if plan:
            break
        errors.append(f"apollo_plan got invalid plan JSON (attempt {attempt}): {raw[:200]!r}")

    if not plan:
        plan = [topic]
        events.append("[Apollo] Planning failed; falling back to the topic itself as the only sub-question.")
    events.append(f"[Apollo] Plan ({len(plan)} sub-questions): " + " | ".join(plan))
    return {"plan": plan, "paused_at": time.time(), "events": events, "errors": errors}


# ---------------------------------------------------------------- human: approve plan


def review_plan(state: ResearchState) -> dict:
    """Interrupt so a human can approve or edit the plan.

    Resume with Command(resume=...) where the value is True / {"approved": True}
    to accept, or {"plan": ["q1", "q2", ...]} to replace the plan.
    LangGraph re-runs this node from the top on resume, so nothing before
    interrupt() may have side effects.
    """
    events, errors = list(state["events"]), list(state["errors"])
    plan = state["plan"]
    if not state["auto_approve"]:
        answer = interrupt({"type": "approve_plan", "topic": state["topic"], "plan": plan})
        edited = _clean_str_list(answer.get("plan")) if isinstance(answer, dict) else []
        if edited:
            plan = edited[: config.MAX_SUBQUESTIONS]
            events.append("[Human] Plan edited: " + " | ".join(plan))
        elif isinstance(answer, dict) and "plan" in answer:
            errors.append("review_plan: edited plan was empty or invalid; keeping the original plan")
            events.append("[Human] Plan approved (edit was invalid).")
        else:
            events.append("[Human] Plan approved.")
    # Research clock starts now: human waiting time does not count against the timeout.
    pause = time.time() - state["paused_at"]
    return {
        "plan": plan,
        "pending_queries": [{"query": q, "section": i} for i, q in enumerate(plan)],
        "started_at": state["started_at"] + pause,
        "events": events,
        "errors": errors,
    }


# ---------------------------------------------------------------- Athena: search


def athena_search(state: ResearchState) -> dict:
    events, errors = list(state["events"]), list(state["errors"])
    findings = list(state["findings"])
    searched = list(state["searched_queries"])
    seen = {_norm_url(f["url"]) for f in findings}
    rnd = state["round_no"]

    # Step 1 (sequential): search each query, pick new pages, assign ids in order.
    new: list[tuple[dict, str]] = []  # (finding without content, search-provider raw text)
    events.append(f"[Athena] Round {rnd}: searching {len(state['pending_queries'])} queries")
    for item in state["pending_queries"]:
        query = item["query"]
        if _timed_out(state):
            errors.append(f"athena_search: timeout reached, skipping remaining queries from {query!r}")
            events.append("[Athena] Timeout reached; stopping this round early.")
            break
        searched.append(query)
        results = web_search(query, errors)
        if not results:
            events.append(f"[Athena] No results for {query!r}; continuing.")
            continue

        added = 0
        for r in results:
            if added >= config.PAGES_PER_QUERY:
                break
            key = _norm_url(r["url"])
            if key in seen:
                continue
            seen.add(key)
            finding = {
                "id": f"S{len(findings) + len(new) + 1}",
                "section": item["section"],
                "query": query,
                "title": r.get("title", ""),
                "url": r["url"],
                "snippet": r.get("snippet", ""),
                "content": "",
                "extracted_by": "",
            }
            new.append((finding, r.get("raw_content", "")))
            added += 1
        events.append(f"[Athena] {query!r}: {len(results)} results, {added} new sources")

    # Step 2 (parallel): extract page text. Ids are already fixed, so finish order does not matter.
    def _extract(entry):
        finding, raw = entry
        errs: list[str] = []
        finding["content"], finding["extracted_by"] = page_content(finding["url"], raw, errs)
        return errs

    with ThreadPoolExecutor(max_workers=config.EXTRACT_WORKERS) as pool:
        for errs in pool.map(_extract, new):  # map keeps input order, so error order is stable
            errors.extend(errs)
    findings.extend(f for f, _ in new)

    with_text = sum(bool(f["content"]) for f, _ in new)
    events.append(
        f"[Athena] Round {rnd} done; {len(new)} new sources ({with_text} with page text), total {len(findings)}"
    )
    return {"findings": findings, "searched_queries": searched, "pending_queries": [], "events": events, "errors": errors}


# ---------------------------------------------------------------- Hermes: review

REVIEW_SYSTEM = (
    "You are Hermes, a strict research reviewer. You see ONLY the sources listed by the user "
    "(id, title, relevant excerpt). Judge coverage using these sources alone; do not use outside knowledge "
    "and never invent sources.\n"
    "1. If every sub-question is reasonably supported by the sources, set complete=true.\n"
    f"2. Otherwise list up to {config.MAX_GAP_QUERIES} short web search queries that would fill the gaps, "
    "each with the number of the sub-question it serves.\n"
    "3. Compare the sources pairwise for contradictions: two listed sources that reach opposite conclusions "
    "about the same question (e.g. one says X lowers a risk, another says X raises it or has no benefit) "
    "or give conflicting numbers for the same quantity. Describe the disputed claim neutrally in one "
    "sentence. Do NOT report differences in scope, emphasis or detail, and report none if there are none.\n"
    'Reply with JSON only: {"complete": true|false, "gaps": [{"section": 1, "query": "..."}], '
    '"contradictions": [{"source_a": "S1", "source_b": "S4", "claim": "..."}]}'
)


def _review_prompt(state: ResearchState, errors: list[str]) -> str:
    """Each source is shown as its title plus the passages most relevant to its sub-question
    (not the search snippet, which is often boilerplate, and not the full text)."""
    lines = [f"Topic: {state['topic']}", "Sub-questions:"]
    lines += [f"{i}. {q}" for i, q in enumerate(state["plan"], 1)]
    lines.append("Sources:")
    for f in state["findings"]:
        question = state["plan"][f["section"]] if f["section"] < len(state["plan"]) else state["topic"]
        excerpt = relevant_passages(f["content"] or f["snippet"], question, config.HERMES_CHARS_PER_SOURCE, errors)
        lines.append(f"[{f['id']}] (sub-question {f['section'] + 1}) {f['title']} — {' '.join(excerpt.split())}")
    if not state["findings"]:
        lines.append("(no sources were found)")
    return "\n".join(lines)


def hermes_review(state: ResearchState) -> dict:
    events, errors = list(state["events"]), list(state["errors"])
    valid_ids = {f["id"] for f in state["findings"]}
    done = {"paused_at": time.time()}  # a human may pause after this node

    raw = ""
    try:
        raw = llm_chat(REVIEW_SYSTEM, _review_prompt(state, errors), temperature=config.REVIEW_TEMPERATURE)
    except Exception as exc:
        errors.append(f"hermes_review LLM call failed: {type(exc).__name__}: {str(exc)[:200]}")
    obj = parse_json(raw)

    if obj is None or not isinstance(obj.get("complete"), bool):
        if raw:
            errors.append(f"hermes_review got invalid JSON: {raw[:200]!r}")
        events.append("[Hermes] Review output unusable; treating as incomplete with no gaps.")
        return {**done, "hermes_complete": False, "gaps": [], "events": events, "errors": errors}

    already = {q.lower() for q in state["searched_queries"]}
    gaps = [g for g in _to_queries(obj.get("gaps"), state["plan"]) if g["query"].lower() not in already]
    gaps = gaps[: config.MAX_GAP_QUERIES]

    contradictions = list(state["contradictions"])
    for c in obj.get("contradictions") or []:
        if not isinstance(c, dict):
            continue
        a, b, claim = c.get("source_a"), c.get("source_b"), c.get("claim")
        # Hermes must not invent sources: keep only contradictions between real ids.
        if a in valid_ids and b in valid_ids and a != b and isinstance(claim, str) and claim.strip():
            contradictions.append({"source_a": a, "source_b": b, "claim": claim.strip()})
        else:
            errors.append(f"hermes_review dropped contradiction with unknown/invalid sources: {c!r}"[:300])

    complete = obj["complete"]
    events.append(
        f"[Hermes] complete={complete}, gaps={[g['query'] for g in gaps]}, contradictions={len(contradictions)}"
    )
    return {
        **done,
        "hermes_complete": complete,
        "gaps": gaps,
        "contradictions": contradictions,
        "events": events,
        "errors": errors,
    }


# ---------------------------------------------------------------- human: approve gaps


def review_gaps(state: ResearchState) -> dict:
    """Optional interrupt to approve, edit, or skip Hermes' gap queries.

    Pauses only when another round would actually run. Resume value: True /
    {"approved": True} to accept, {"skip": True} to skip, or
    {"gaps": ["query", ...]} to replace them.
    """
    if state["auto_approve"] or not state["review_gaps"]:
        return {}
    # Evaluate the stop rules at paused_at (not "now") so the answer is the same
    # when LangGraph re-runs this node on resume.
    if _stop_reason(state, now=state["paused_at"]) is not None:
        return {}

    events, errors = list(state["events"]), list(state["errors"])
    answer = interrupt({"type": "approve_gaps", "round": state["round_no"], "gaps": [g["query"] for g in state["gaps"]]})
    update: dict = {}
    if isinstance(answer, dict) and answer.get("skip"):
        update = {"gaps": [], "gaps_skipped": True}
        events.append("[Human] Gap queries skipped.")
    elif isinstance(answer, dict) and "gaps" in answer:
        edited = _to_queries(_clean_str_list(answer.get("gaps")), state["plan"])[: config.MAX_GAP_QUERIES]
        if edited:
            update = {"gaps": edited}
            events.append(f"[Human] Gap queries edited: {[g['query'] for g in edited]}")
        else:
            errors.append("review_gaps: edited gap list was empty or invalid; keeping Hermes' gaps")
    else:
        events.append("[Human] Gap queries approved.")
    pause = time.time() - state["paused_at"]
    return {**update, "started_at": state["started_at"] + pause, "events": events, "errors": errors}


# ---------------------------------------------------------------- Apollo: decide


def decide(state: ResearchState) -> dict:
    """Stop rules live in _stop_reason, in code."""
    events = list(state["events"])
    reason = _stop_reason(state)
    if reason is None:
        nxt = state["round_no"] + 1
        events.append(f"[Apollo] Starting round {nxt} with gap queries: {[g['query'] for g in state['gaps']]}")
        return {"round_no": nxt, "pending_queries": list(state["gaps"]), "events": events}

    status = "complete" if state["findings"] else "failed"
    events.append(f"[Apollo] Stopping: {reason} (round {state['round_no']}, {_elapsed(state):.1f}s). Status: {status}")
    return {"status": status, "stop_reason": reason, "events": events}


def route_after_decide(state: ResearchState):
    """Another research round, or one write_section task per plan section (run in parallel)."""
    if state["status"] == "running":
        return "athena_search"
    return [
        Send(
            "write_section",
            {
                "index": i,
                "question": q,
                "topic": state["topic"],
                "findings": [f for f in state["findings"] if f["section"] == i],
            },
        )
        for i, q in enumerate(state["plan"])
    ]


# ---------------------------------------------------------------- Apollo: write

WRITE_SYSTEM = (
    "You are Apollo's writer. Write ONE short paragraph (3-5 sentences, no headings, no bullet points) "
    "that answers the sub-question using ONLY the numbered sources the user gives you.\n"
    "Rules:\n"
    "- Use only facts stated in these sources, even if you know other facts about the topic.\n"
    "- Paraphrase closely. Do not add names, descriptions, numbers, examples or qualifiers that the "
    "cited source text does not contain, and do not merge facts from different sources into one claim "
    "unless you cite each of them.\n"
    "- End every sentence with the citation(s) of the source(s) that state it, like [S3] or [S3][S5].\n"
    "- Never cite an id that is not in the list.\n"
    f"- If the sources do not support a point the sub-question asks about, write a sentence saying it was "
    f"\"{NOT_FOUND}\" (with no citation).\n"
    "Reply with the paragraph only."
)


def _source_block(findings: list[dict], question: str, errors: list[str]) -> str:
    """Each source's passages most relevant to the sub-question (not just its first N chars)."""
    parts = []
    for f in findings:
        text = relevant_passages(f["content"] or f["snippet"], question, config.WRITE_CHARS_PER_SOURCE, errors)
        parts.append(f"[{f['id']}] {f['title']}\n{text}")
    return "\n\n".join(parts)


def enforce_citations(
    text: str, allowed_ids: set[str], errors: list[str], where: str, allow=(), dropped: list[str] | None = None
) -> list[str]:
    """Keep only sentences whose citations are all allowed and that cite something.

    Unknown ids are stripped from a sentence. A sentence with no valid citation is
    dropped unless it says "not found in sources" or matches one of `allow` (regexes).
    Dropped sentences are also appended to `dropped` when given.
    """
    kept = []
    for sentence in split_sentences(normalize_not_found(normalize_citations(text))):
        bad = [i for i in find_citations(sentence) if i not in allowed_ids]
        for i in bad:
            sentence = sentence.replace(f"[{i}]", "")
        if bad:
            errors.append(f"{where}: removed citation(s) to ids not in its sources: {bad}")
        sentence = re.sub(r"\s+([.,;:])", r"\1", re.sub(r"\s{2,}", " ", sentence)).strip()
        if not sentence:
            continue
        sentence = mark_absence(sentence[0].upper() + sentence[1:])
        if find_citations(sentence) or NOT_FOUND in sentence.lower() or any(re.search(p, sentence, re.I) for p in allow):
            kept.append(sentence)
        elif sentence:
            errors.append(f"{where}: dropped uncited sentence: {sentence[:120]!r}")
            if dropped is not None:
                dropped.append(sentence)
    return kept


DRAFT_INTERVAL_SECONDS = 0.25  # how often a section's in-progress text is pushed to the browser


def _draft_publisher(index: int):
    """on_text callback: publish the section's text-so-far as a `section_draft` event, throttled.
    Drafts are raw model output; the final text (after citation enforcement) arrives with
    `section_written` and replaces it."""
    last = [0.0]

    def on_text(text: str) -> None:
        now = time.monotonic()
        if now - last[0] >= DRAFT_INTERVAL_SECONDS:
            last[0] = now
            live.publish("section_draft", {"index": index, "text": text})

    return on_text


def write_section(task: dict) -> dict:
    """Runs once per section (via Send). Writes to `sections` only (it has a reducer)."""
    index, question, findings = task["index"], task["question"], task["findings"]
    errors: list[str] = []
    ids = [f["id"] for f in findings]
    usable = [f for f in findings if f["content"] or f["snippet"]]

    text = ""
    if usable:
        allowed = {f["id"] for f in usable}
        user = f"Sub-question: {question}\n\nSources:\n{_source_block(usable, question, errors)}"
        best: list[str] = []
        replied = False  # did any model answer? If not, the section was never written
        for attempt in (1, 2):  # first try + one retry with feedback if any sentence had to be dropped
            dropped: list[str] = []
            try:
                raw = llm_chat(WRITE_SYSTEM, user, temperature=config.WRITE_TEMPERATURE, on_text=_draft_publisher(index))
            except Exception as exc:
                errors.append(f"write_section {index + 1} LLM call failed: {type(exc).__name__}: {str(exc)[:200]}")
                break
            replied = True
            kept = enforce_citations(raw, allowed, errors, f"write_section {index + 1} (attempt {attempt})", dropped=dropped)
            if sum(bool(find_citations(s)) for s in kept) > sum(bool(find_citations(s)) for s in best) or not best:
                best = kept
            if not dropped:
                break
            user += (
                "\n\nYour previous answer had sentences without a valid citation, which were removed:\n"
                + "\n".join(f"- {s}" for s in dropped)
                + f"\nRewrite the paragraph. Every sentence must end with [S#] ids from the list above, "
                f"or say it was \"{NOT_FOUND}\"."
            )
        text = " ".join(best)
        if not text and not replied:
            text = WRITE_FAILED  # an LLM outage is not evidence that the sources are silent
    # Code, not the model, guarantees the fallback wording.
    if not text:
        text = "Not found in sources."
    section: Section = {"index": index, "question": question, "text": text, "source_ids": ids, "errors": errors}
    return {"sections": [section]}


# ---------------------------------------------------------------- Apollo: assemble

ASSEMBLE_SYSTEM = (
    "You are Apollo, finishing a research report. You get the report's sections, which already carry "
    "citations like [S3]. Write a 2-3 sentence introduction and a 2-3 sentence conclusion using ONLY "
    "what the sections say. Every sentence must either reuse the [S#] citations from the sections it "
    "draws on, or explicitly say it summarises the sections (e.g. 'The sections below summarise ...'). "
    "Add no new facts. "
    'Reply with JSON only: {"intro": "...", "conclusion": "..."}'
)
_SUMMARY_PHRASE = (r"\bsummari[sz]e", r"\bsummary\b")


def assemble(state: ResearchState) -> dict:
    events, errors = list(state["events"]), list(state["errors"])
    sections = sorted(state["sections"], key=lambda s: s["index"])
    for s in sections:
        errors.extend(s["errors"])

    # 1. Section bodies, with duplicate sentences removed (first occurrence wins).
    seen: set[str] = set()

    def dedupe(sentences: list[str]) -> list[str]:
        out = []
        for s in sentences:
            key = sentence_key(s)
            if key and key in seen and NOT_FOUND not in s.lower() and s != WRITE_FAILED:
                errors.append(f"assemble: removed duplicate sentence: {s[:100]!r}")
                continue
            seen.add(key)
            out.append(s)
        return out

    bodies = [" ".join(dedupe(split_sentences(s["text"]))) or "Not found in sources." for s in sections]
    section_ids = {i for body in bodies for i in find_citations(body)}

    # 2. Intro and conclusion, limited to ids already cited in the sections.
    intro = conclusion = []
    if section_ids:
        joined = "\n\n".join(f"Section {s['index'] + 1}: {s['question']}\n{b}" for s, b in zip(sections, bodies))
        try:
            obj = parse_json(llm_chat(ASSEMBLE_SYSTEM, f"Topic: {state['topic']}\n\n{joined}", config.WRITE_TEMPERATURE)) or {}
        except Exception as exc:
            obj = {}
            errors.append(f"assemble LLM call failed: {type(exc).__name__}: {str(exc)[:200]}")
        intro = dedupe(enforce_citations(str(obj.get("intro", "")), section_ids, errors, "intro", _SUMMARY_PHRASE))
        conclusion = dedupe(
            enforce_citations(str(obj.get("conclusion", "")), section_ids, errors, "conclusion", _SUMMARY_PHRASE)
        )
    intro_text = " ".join(intro) or "This report summarises what the retrieved sources say about each sub-question below."
    concl_text = " ".join(conclusion) or "In summary, see the sections above; each claim cites the source it comes from."

    # 3. Report body and References (only ids actually cited).
    parts = [f"# {state['topic']}", "## Introduction", intro_text]
    for s, body in zip(sections, bodies):
        parts += [f"## {s['index'] + 1}. {s['question']}", body]
    parts += ["## Conclusion", concl_text]
    report = "\n\n".join(parts)

    by_id = {f["id"]: f for f in state["findings"]}
    cited = sorted({i for i in find_citations(report) if i in by_id}, key=int_id)
    references = [{"id": i, "title": by_id[i]["title"], "url": by_id[i]["url"]} for i in cited]
    unused = len(by_id) - len(cited)
    events.append(f"[Apollo] Report assembled: {len(sections)} sections, {len(cited)} sources cited, {unused} uncited excluded")
    return {"report": report, "references": references, "events": events, "errors": errors}


# ---------------------------------------------------------------- verify


def verify_claims(state: ResearchState) -> dict:
    events, errors = list(state["events"]), list(state["errors"])
    claims = verify_report(state["report"], state["findings"], errors)
    counts = {k: sum(c["status"] == k for c in claims) for k in ("verified", "partial", "not_found", "unchecked")}
    events.append(f"[Verify] {len(claims)} cited claims: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    return {"claims": claims, "events": events, "errors": errors}
