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
"""

import config
from llm import chat as llm_chat
from tools.embed import embed
from tools.jsonparse import parse_json
from tools.retry_policy import is_quota_exhausted
from tools.text import find_citations, split_sentences, strip_citations

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
    sentence_cache: dict[str, tuple[list[str], object]] = {}
    results = []
    # Shared by all claims: a model whose daily quota is spent is removed for the rest of the report.
    models = _available_chain()
    if not models:
        errors.append("verify: no verification model has an API key; all claims 'unchecked'")

    for n, claim in enumerate(claims):
        ids = [i for i in find_citations(claim) if i in by_id]
        result = {"claim": claim, "source_ids": ids, "status": "not_found", "best_match": "", "similarity": 0.0, "evidence": ""}
        if n >= config.VERIFY_MAX_CLAIMS:
            result["status"] = "unchecked"
            results.append(result)
            continue
        try:
            claim_vec = embed([strip_citations(claim)])[0]
        except Exception as exc:
            errors.append(f"verify: embedding failed: {type(exc).__name__}: {str(exc)[:200]}")
            results.append(result)
            continue

        supported = False
        for sid in ids:
            if sid not in sentence_cache:
                sents = _source_sentences(by_id[sid])
                sentence_cache[sid] = (sents, embed(sents) if sents else None)
            sents, vecs = sentence_cache[sid]
            if not sents:
                continue
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
        results.append(result)
    return results


def _ask(prompt: str, models: list[tuple[str, str]], errors: list[str], sid: str) -> str | None:
    """Ask the first model in `models`. If its daily quota is spent, drop it and try the next.

    `models` is shared across the whole report, so once a model is exhausted it is not
    called again; when the list is empty, verification stops calling the LLM.
    """
    while models:
        try:
            provider, model = models[0]
            return llm_chat(VERIFY_SYSTEM, prompt, temperature=0.0, model=model, provider=provider)
        except Exception as exc:
            if is_quota_exhausted(exc):
                dropped = models.pop(0)
                nxt = f"switching to {models[0][0]}:{models[0][1]}" if models else "remaining claims will be 'unchecked'"
                errors.append(f"verify: quota exhausted for {dropped[0]}:{dropped[1]}; {nxt}")
                continue
            errors.append(f"verify: LLM call failed for {sid}: {type(exc).__name__}: {str(exc)[:200]}")
            return None
    return None
