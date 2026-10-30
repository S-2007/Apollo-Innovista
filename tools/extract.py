"""Page text extraction for Athena.

page_content(url, raw_content, errors) -> (text, extracted_by)

1. extract_text(url): our own fetch + trafilatura (main article text only).
   - Checks Content-Type first and skips non-HTML (PDFs etc.) without downloading
     the body, since trafilatura only parses HTML.
   - Streams the body with a TOTAL deadline and byte cap. (requests' `timeout`
     only limits the gap between packets, so a big file could otherwise take
     far longer than REQUEST_TIMEOUT_SECONDS.)
   - Sends an honest bot User-Agent. Sites that refuse it (403) are not worked around.
2. If that yields fewer than MIN_CONTENT_CHARS, fall back to `raw_content`: the
   page text the search provider (Tavily) already retrieved. This is still
   retrieved source text, never LLM output.

Text is capped at EXTRACT_MAX_CHARS. Failures return "" and are logged to
`errors`; the finding is still kept with its search snippet.
"""

import re
import time

import requests
import trafilatura

import config

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ApolloResearchBot/0.1)"}
_HTML_TYPES = ("text/html", "application/xhtml+xml")


def extract_text(url: str, errors: list[str]) -> str:
    """Fetch `url` and return its main text, or "" (reason appended to `errors`)."""
    try:
        with requests.get(url, headers=_HEADERS, timeout=config.REQUEST_TIMEOUT_SECONDS, stream=True) as resp:
            resp.raise_for_status()
            ctype = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if ctype and ctype not in _HTML_TYPES:
                errors.append(f"extract skipped non-HTML ({ctype}) at {url}")
                return ""
            body, deadline = b"", time.time() + config.REQUEST_TIMEOUT_SECONDS
            for chunk in resp.iter_content(chunk_size=65536):
                body += chunk
                if len(body) >= config.MAX_PAGE_BYTES or time.time() > deadline:
                    break
        # Pass bytes so trafilatura detects the character encoding itself.
        text = trafilatura.extract(body, include_comments=False, include_tables=False) or ""
    except Exception as exc:
        errors.append(f"extract failed for {url}: {type(exc).__name__}: {str(exc)[:200]}")
        return ""
    if len(text) < config.MIN_CONTENT_CHARS:
        errors.append(f"extract found no main text at {url} ({len(text)} chars)")
        return ""
    return text[: config.EXTRACT_MAX_CHARS]


def page_content(url: str, raw_content: str, errors: list[str]) -> tuple[str, str]:
    """Return (text, extracted_by) using our extractor first, then the search provider's text."""
    own_errors: list[str] = []
    text = extract_text(url, own_errors)
    if text:
        return text, "trafilatura"
    # Collapse spaces but keep line breaks: they mark headings/paragraphs, which sentence splitting needs.
    raw = re.sub(r"[ \t\f\v\x08]+", " ", raw_content or "")
    raw = re.sub(r"\s*\n\s*", "\n", raw).strip()
    if len(raw) >= config.MIN_CONTENT_CHARS:
        return raw[: config.EXTRACT_MAX_CHARS], "tavily_raw"
    errors.extend(own_errors)
    errors.append(f"no page text for {url}: extraction failed and search provider gave none")
    return "", ""
