"""Athena's web search wrapper: Tavily first, Serper as fallback.

search(query, errors) returns a list of {"title", "url", "snippet", "raw_content"} dicts.
`raw_content` is the page text Tavily already fetched (include_raw_content); it is
used by tools/extract.py as a fallback when our own extraction fails. Serper
does not provide it, so it is "" there.
Each provider call is retried with tenacity (SEARCH_MAX_RETRIES retries,
exponential backoff, transient errors only; see tools/retry_policy.py).
If Tavily fails or returns nothing, Serper is tried.
If both fail or return nothing, the function returns [] and appends a message
to `errors` — it never raises, so one bad query cannot crash the pipeline.
"""

import requests

import config
from tools.retry_policy import with_retries

SERPER_URL = "https://google.serper.dev/search"

_retry = with_retries(config.SEARCH_MAX_RETRIES)


@_retry
def _tavily(query: str) -> list[dict]:
    from tavily import TavilyClient

    client = TavilyClient(api_key=config.TAVILY_API_KEY)
    resp = client.search(
        query,
        max_results=config.RESULTS_PER_QUERY,
        include_raw_content="text",
        timeout=config.REQUEST_TIMEOUT_SECONDS,
    )
    return [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("content", ""),
            # Some pages are hundreds of KB of text; only EXTRACT_MAX_CHARS are kept after cleanup.
            "raw_content": (r.get("raw_content") or "")[: config.EXTRACT_MAX_CHARS * 4],
        }
        for r in resp.get("results", [])
        if r.get("url")
    ]


@_retry
def _serper(query: str) -> list[dict]:
    resp = requests.post(
        SERPER_URL,
        headers={"X-API-KEY": config.SERPER_API_KEY, "Content-Type": "application/json"},
        json={"q": query, "num": config.RESULTS_PER_QUERY},
        timeout=config.REQUEST_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    return [
        {"title": r.get("title", ""), "url": r.get("link", ""), "snippet": r.get("snippet", ""), "raw_content": ""}
        for r in resp.json().get("organic", [])
        if r.get("link")
    ]


def search(query: str, errors: list[str]) -> list[dict]:
    """Run one web search. Never raises; failures are appended to `errors`."""
    providers = [("tavily", _tavily, config.TAVILY_API_KEY), ("serper", _serper, config.SERPER_API_KEY)]
    for name, fn, key in providers:
        if not key:
            errors.append(f"search[{name}] skipped for {query!r}: API key not set")
            continue
        try:
            results = fn(query)
        except Exception as exc:  # network, auth, rate limit, bad JSON...
            errors.append(f"search[{name}] failed for {query!r}: {type(exc).__name__}: {str(exc)[:200]}")
            continue
        if results:
            return results
        errors.append(f"search[{name}] returned no results for {query!r}")
    return []
