"""One function per source API. Each returns Athena's search-result shape:

    {"title", "url", "snippet", "raw_content", "published", "api_text"}

`raw_content` is text the API itself returned (an abstract for papers); `api_text` = True means it is
the source's own text, so Athena uses it as the page content instead of downloading the landing page
(publisher pages are often paywalled or blocked). Calls are retried on transient errors only
(429, 5xx, timeouts, connection errors) by tools/retry_policy.py; 400/401/403 fail at once.
An adapter raises on failure; the router (router.py) turns failures into fallbacks and errors.

Every API here is free; the optional keys only raise rate limits.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Callable

import requests

from core import config
from tools import search as web
from tools.retry_policy import with_retries

_retry = with_retries(config.SEARCH_MAX_RETRIES)
_TAG = re.compile(r"<[^>]+>")


def _text(value: str) -> str:
    """Plain text: tags removed (Europe PMC abstracts carry <h4>, <i>), spaces collapsed."""
    return " ".join(_TAG.sub(" ", value or "").split())


def _get(url: str, headers: dict | None = None, **params) -> requests.Response:
    resp = requests.get(url, params=params, headers=headers, timeout=config.REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp


def _result(title: str, url: str, abstract: str, published: str) -> dict:
    abstract = _text(abstract)
    return {"title": _text(title), "url": url, "snippet": abstract[:300], "raw_content": abstract,
            "published": published or "", "api_text": bool(abstract)}


# ---------------------------------------------------------------- academic


def abstract_from_inverted_index(index: dict | None) -> str:
    """OpenAlex stores abstracts as {word: [positions]}; put the words back in order."""
    if not index:
        return ""
    slots: dict[int, str] = {}
    for word, positions in index.items():
        for p in positions:
            slots[p] = word
    return " ".join(slots[p] for p in sorted(slots))


@_retry
def openalex(query: str) -> list[dict]:
    params = {"search": query, "per_page": config.RESULTS_PER_QUERY}
    if config.OPENALEX_MAILTO:
        params["mailto"] = config.OPENALEX_MAILTO
    works = _get("https://api.openalex.org/works", **params).json().get("results", [])
    out = []
    for w in works:
        url = w.get("doi") or (w.get("primary_location") or {}).get("landing_page_url") or w.get("id") or ""
        if url:
            out.append(_result(w.get("display_name") or w.get("title") or "", url,
                               abstract_from_inverted_index(w.get("abstract_inverted_index")),
                               w.get("publication_date") or ""))
    return out


@_retry
def semantic_scholar(query: str) -> list[dict]:
    headers = {"x-api-key": config.SEMANTIC_SCHOLAR_API_KEY} if config.SEMANTIC_SCHOLAR_API_KEY else None
    papers = _get("https://api.semanticscholar.org/graph/v1/paper/search", query=query,
                  limit=config.RESULTS_PER_QUERY, fields="title,abstract,url,publicationDate,year,externalIds",
                  headers=headers).json().get("data", []) or []
    out = []
    for p in papers:
        doi = (p.get("externalIds") or {}).get("DOI")
        url = f"https://doi.org/{doi}" if doi else p.get("url") or ""
        if url:
            out.append(_result(p.get("title") or "", url, p.get("abstract") or "",
                               p.get("publicationDate") or str(p.get("year") or "")))
    return out


# ---------------------------------------------------------------- health

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


def parse_pubmed_xml(xml: str) -> list[dict]:
    """PubMed efetch XML -> results (title, abstract sections joined, publication date)."""
    out = []
    for art in ET.fromstring(xml).iter("PubmedArticle"):
        pmid = art.findtext(".//MedlineCitation/PMID") or ""
        node = art.find(".//ArticleTitle")
        title = "".join(node.itertext()) if node is not None else ""
        parts = []
        for node in art.iterfind(".//Abstract/AbstractText"):
            label, text = node.get("Label"), "".join(node.itertext())
            parts.append(f"{label}: {text}" if label else text)
        date = art.find(".//Article/ArticleDate")
        if date is None:
            date = art.find(".//JournalIssue/PubDate")
        ymd = [date.findtext(k) for k in ("Year", "Month", "Day")] if date is not None else []
        published = "-".join(v.zfill(2) for v in ymd if v and v.isdigit())
        if pmid:
            out.append(_result(title, f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", " ".join(parts), published))
    return out


@_retry
def pubmed(query: str) -> list[dict]:
    key = {"api_key": config.NCBI_API_KEY} if config.NCBI_API_KEY else {}
    ids = _get(f"{EUTILS}/esearch.fcgi", db="pubmed", term=query, retmax=config.RESULTS_PER_QUERY,
               retmode="json", **key).json().get("esearchresult", {}).get("idlist", [])
    if not ids:
        return []
    return parse_pubmed_xml(_get(f"{EUTILS}/efetch.fcgi", db="pubmed", id=",".join(ids), retmode="xml", **key).text)


@_retry
def europe_pmc(query: str) -> list[dict]:
    hits = (_get("https://www.ebi.ac.uk/europepmc/webservices/rest/search", query=query, format="json",
                 pageSize=config.RESULTS_PER_QUERY, resultType="core")
            .json().get("resultList", {}).get("result", []))
    out = []
    for h in hits:
        url = (f"https://doi.org/{h['doi']}" if h.get("doi")
               else f"https://europepmc.org/article/{h.get('source', 'MED')}/{h.get('id', '')}" if h.get("id") else "")
        if url:
            out.append(_result(h.get("title") or "", url, h.get("abstractText") or "",
                               h.get("firstPublicationDate") or str(h.get("pubYear") or "")))
    return out


# ---------------------------------------------------------------- registry


@dataclass(frozen=True)
class Adapter:
    fn: Callable[[str], list[dict]]
    key: Callable[[], str] | None = None  # None = no key needed; else the key, "" when not configured


ADAPTERS: dict[str, Adapter] = {
    # Looked up on each call (not bound at import), so the web providers stay replaceable in tools/search.py.
    "tavily": Adapter(lambda q: web._tavily(q), lambda: config.TAVILY_API_KEY),
    "serper": Adapter(lambda q: web._serper(q), lambda: config.SERPER_API_KEY),
    "openalex": Adapter(openalex),
    "semantic_scholar": Adapter(semantic_scholar),
    "pubmed": Adapter(pubmed),
    "europe_pmc": Adapter(europe_pmc),
}
