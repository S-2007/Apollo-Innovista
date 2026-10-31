"""Claim verification against the RETRIEVED source text (never the LLM's memory).

verify_report(report, findings, errors) -> list[ClaimCheck]

For every report sentence that carries a citation:
1. For each cited source, split its retrieved text (page content, else snippet)
   into sentences and embed them with sentence-transformers all-MiniLM-L6-v2.
   The sentence with the highest cosine similarity to the claim is the best match.
2. Ask the LLM a yes/no question about the VERIFY_TOP_K best-matching
   sentences (in source order; a claim can combine facts from two places):
   {"supported": bool, "evidence": "..."}.
3. Status:
   - verified : the LLM says at least one cited source's text supports the claim
   - partial  : no "yes", but some cited source has a closely related sentence
                (similarity >= VERIFY_PARTIAL_SIM): related, not fully backed
   - not_found: neither (or the source has no retrieved text)
   - unchecked: over the VERIFY_MAX_CLAIMS cap, or every model's daily quota is
                spent (counted and reported, never hidden)

Models: config.VERIFY_CHAIN, e.g. Groq gpt-oss-20b -> Groq gpt-oss-120b -> Gemini
(each has its own quota; providers without an API key are skipped). When a model's
daily quota is spent, verification moves to the next one for the rest of the report.

Speed: claims are checked VERIFY_WORKERS at a time (each claim is mostly waiting for the LLM),
all needed sentences are embedded in one batch up front, and each finished claim is published
as a live `claim_checked` progress event. Results keep the report's claim order.
"""

import contextvars
import threading
from concurrent.futures import ThreadPoolExecutor

import config
import live
from llm import chat as llm_chat
from tools.embed import embed
from tools.jsonparse import parse_json
from tools.retry_policy import is_quota_exhausted
from tools.text import find_citations, split_sentences, strip_citations, top_by_keywords

VERIFY_SYSTEM = (
    "You check whether a source text supports a claim. Judge ONLY from the source text given; "
    "do not use outside knowledge. If the text states the claim (or a clear paraphrase), supported=true. "
    "If it only discusses the topic, contradicts it, or gives different numbers, supported=false. "
    'Answer JSON only: {"supported": true|false, "evidence": "<short quote from the source text, or empty>"}'
)


def _available_chain() -> list[tuple[str, str]]:
    keys = {"groq": config.GROQ_API_KEY, "gemini": config.GEMINI_API_KEY}
    return [(p, m) for p, m in dict.fromkeys(config.VERIFY_CHAIN) if keys.get(p)]


def report_claims(report: str) -> list[str]:
    """Sentences of the report body (headings skipped) that carry at least one citation."""
    body = "\n".join(line for line in report.splitlines() if not line.lstrip().startswith("#"))
    return [s for s in split_sentences(body) if find_citations(s)]


def _source_sentences(finding: dict) -> list[str]:
    text = finding.get("content") or finding.get("snippet") or ""
    return [s for s in split_sentences(text) if len(s) >= 20]


def verify_report(report: str, findings: list[dict], errors: list[str]) -> list[dict]:
    by_id = {f["id"]: f for f in findings}
    claims = report_claims(report)
    # Shared by all claims: a model whose daily quota is spent is removed for the rest of the report.
    models = _available_chain()
    if not models:
        errors.append("verify: no verification model has an API key; all claims 'unchecked'")

    def candidates(claim: str, sid: str) -> list[str]:
        # On slow hosts only the sentences sharing the most words with the claim are compared
        # (VERIFY_MAX_SENTENCES > 0). tools.embed caches each sentence's vector for the whole run.
        return top_by_keywords(_source_sentences(by_id[sid]), strip_citations(claim), config.VERIFY_MAX_SENTENCES)

    checked = claims[: config.VERIFY_MAX_CLAIMS]
    # One embedding batch for everything the checks will compare (cached), instead of many small ones.
    wanted = [strip_citations(c) for c in checked]
    wanted += [s for c in checked for sid in find_citations(c) if sid in by_id for s in candidates(c, sid)]
    try:
        if wanted:
            embed(list(dict.fromkeys(wanted)))
    except Exception:
        pass  # each claim retries its own embedding below and reports a failure there

    total, done = len(checked), [0]
    progress = threading.Lock()

    def check(claim: str) -> dict:
        result = _check_claim(claim, by_id, models, errors, candidates)
        with progress:
            done[0] += 1
            n = done[0]
        live.publish("claim_checked", {"done": n, "total": total, "status": result["status"]})
        return result

    with ThreadPoolExecutor(max_workers=max(1, config.VERIFY_WORKERS), thread_name_prefix="verify") as pool:
        # Each task runs in a copy of this context, so LangGraph's run id still reaches the usage
        # meter and the live progress events from the worker threads.
        futures = [pool.submit(contextvars.copy_context().run, check, c) for c in checked]
        results = [f.result() for f in futures]

    for claim in claims[config.VERIFY_MAX_CLAIMS :]:
        ids = [i for i in find_citations(claim) if i in by_id]
        results.append({"claim": claim, "source_ids": ids, "status": "unchecked", "best_match": "",
                        "similarity": 0.0, "evidence": ""})
    return results


def _check_claim(claim: str, by_id: dict, models: list[tuple[str, str]], errors: list[str], candidates) -> dict:
    ids = [i for i in find_citations(claim) if i in by_id]
    result = {"claim": claim, "source_ids": ids, "status": "not_found", "best_match": "", "similarity": 0.0, "evidence": ""}
    try:
        claim_vec = embed([strip_citations(claim)])[0]
    except Exception as exc:
        errors.append(f"verify: embedding failed: {type(exc).__name__}: {str(exc)[:200]}")
        return result

    supported = False
    for sid in ids:
        sents = candidates(claim, sid)
        if not sents:
            continue
        vecs = embed(sents)
        sims = vecs @ claim_vec
        best = int(sims.argmax())
        if float(sims[best]) > result["similarity"]:
            result["similarity"], result["best_match"] = round(float(sims[best]), 3), sents[best]
        if not models:  # every model's quota is spent: stop calling the LLM
            continue
        top = sorted(sims.argsort()[::-1][: config.VERIFY_TOP_K].tolist())  # keep source order
        window = " ... ".join(sents[i] for i in top)
        raw = _ask(f"Claim: {strip_citations(claim)}\n\nSource text ({sid}): {window}", models, errors, sid)
        if raw is None:
            continue
        obj = parse_json(raw)
        if obj is None or not isinstance(obj.get("supported"), bool):
            errors.append(f"verify: invalid JSON for {sid}: {raw[:120]!r}")
            continue
        if obj["supported"]:
            supported = True
            result["evidence"] = str(obj.get("evidence", ""))[:300]
            result["best_match"] = sents[best]
            break

    if supported:
        result["status"] = "verified"
    elif not models:
        result["status"] = "unchecked"  # never mark a claim checked when the LLM could not be asked
    elif result["similarity"] >= config.VERIFY_PARTIAL_SIM:
        result["status"] = "partial"
    return result


_models_lock = threading.Lock()


def _ask(prompt: str, models: list[tuple[str, str]], errors: list[str], sid: str) -> str | None:
    """Ask the first model in `models`. If its daily quota is spent, drop it and try the next.

    `models` is shared across the whole report, so once a model is exhausted it is not
    called again; when the list is empty, verification stops calling the LLM.
    """
    while True:
        with _models_lock:
            if not models:
                return None
            provider, model = models[0]
        try:
            return llm_chat(VERIFY_SYSTEM, prompt, temperature=0.0, model=model, provider=provider)
        except Exception as exc:
            if is_quota_exhausted(exc):
                with _models_lock:
                    # Several claims run at once: only the first to see this model fail removes it.
                    if models and models[0] == (provider, model):
                        models.pop(0)
                        nxt = f"switching to {models[0][0]}:{models[0][1]}" if models else "remaining claims will be 'unchecked'"
                        errors.append(f"verify: quota exhausted for {provider}:{model}; {nxt}")
                continue
            errors.append(f"verify: LLM call failed for {sid}: {type(exc).__name__}: {str(exc)[:200]}")
            return None
