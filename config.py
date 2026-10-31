"""Central configuration for Apollo.

All secrets and loop limits are read from .env (via python-dotenv) with safe
defaults. Nothing here is hardcoded except the defaults themselves. Other
modules import values from here instead of reading os.environ directly, so
there is exactly one place to look when asking "where does X come from?".
"""

import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


# --- API keys (empty string means "not configured") ---
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# --- LLM selection ---
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
# A second Gemini model with its own capacity: used when GEMINI_MODEL is overloaded (503).
GEMINI_FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-flash-lite-latest")
PLAN_TEMPERATURE = 0.2
REVIEW_TEMPERATURE = 0.2
WRITE_TEMPERATURE = 0.2
# Claim verification uses a separate (smaller) model: on Groq each model has its own rate limit.
VERIFY_MODEL = os.getenv("VERIFY_MODEL", "openai/gpt-oss-20b")
# Fallback chain for planning, review and writing, "provider:model" in order. The default starts
# with LLM_PROVIDER's model, then the other models, so a spent daily quota or a rate-limit burst
# on one model moves the call to the next instead of failing the section. Providers without a key
# are skipped.
_DEFAULT_LLM_MODELS = {"groq": [f"groq:{GROQ_MODEL}", f"groq:{VERIFY_MODEL}"], "gemini": [f"gemini:{GEMINI_MODEL}", f"gemini:{GEMINI_FALLBACK_MODEL}"]}
LLM_CHAIN = [
    tuple(item.strip().split(":", 1))
    for item in os.getenv(
        "LLM_CHAIN",
        ",".join(dict.fromkeys(
            _DEFAULT_LLM_MODELS.get(LLM_PROVIDER, []) + [m for ms in _DEFAULT_LLM_MODELS.values() for m in ms]
        )),
    ).split(",")
    if ":" in item
]
LLM_COOLDOWN_SECONDS = _int("LLM_COOLDOWN_SECONDS", 600)  # skip a model this long after its quota ran out

# Fallback chain for claim verification, "provider:model" in order. Each entry has its own quota;
# when one is spent for the day, verification moves on. Providers without a key are skipped.
VERIFY_CHAIN = [
    tuple(item.strip().split(":", 1))
    for item in os.getenv(
        "VERIFY_CHAIN", f"groq:{VERIFY_MODEL},groq:{GROQ_MODEL},gemini:{GEMINI_MODEL},gemini:{GEMINI_FALLBACK_MODEL}"
    ).split(",")
    if ":" in item
]

# --- Loop control (the graph enforces these in code) ---
MAX_ROUNDS = _int("MAX_ROUNDS", 2)
TIMEOUT_SECONDS = _int("TIMEOUT_SECONDS", 180)
SEARCH_MAX_RETRIES = _int("SEARCH_MAX_RETRIES", 2)
LLM_MAX_RETRIES = _int("LLM_MAX_RETRIES", 2)
REQUEST_TIMEOUT_SECONDS = _int("REQUEST_TIMEOUT_SECONDS", 15)

# --- Research breadth ---
MIN_SUBQUESTIONS = 3
MAX_SUBQUESTIONS = 5
RESULTS_PER_QUERY = 5      # results requested from the search API
PAGES_PER_QUERY = 3        # top results whose full page text is extracted
MAX_GAP_QUERIES = 3        # cap on Hermes follow-up queries per round
EXTRACT_MAX_CHARS = 12000  # cap on stored page text (LLMs see only selected passages, see tools/passages.py)
MIN_CONTENT_CHARS = 200    # shorter extracts count as failed (use the fallback)
MAX_PAGE_BYTES = _int("MAX_PAGE_BYTES", 3_000_000)  # stop downloading a page after this many bytes
EXTRACT_WORKERS = _int("EXTRACT_WORKERS", 6)  # pages extracted in parallel per round (lower it on small servers)
SEARCH_WORKERS = _int("SEARCH_WORKERS", 5)  # web searches run at once per round (each waits on the API)
# Which page text Athena tries first: "own" (default: download + trafilatura, then the search provider's
# text) or "provider_first" (Tavily's page text when it has enough, download + trafilatura only for the
# rest). provider_first skips most downloads and HTML parsing, the slowest step on Render free's 0.1 CPU.
EXTRACT_ORDER = os.getenv("EXTRACT_ORDER", "own").strip().lower()

# --- Research quality rules (tools/quality.py) ---
MIN_SOURCES_PER_QUESTION = _int("MIN_SOURCES_PER_QUESTION", 2)  # readable sources each sub-question should have
# Share of word 5-grams two pages must have in common to count as the same article. Different articles share
# almost none; one paper on two URLs shared 71% (one copy also carried a cookie banner), so 0.8 missed it.
DUPLICATE_OVERLAP = 0.5
MIN_RELEVANCE = 0.3       # share of the sub-question's key words a page must contain (tools/quality.relevance)
# Read each page's stated publication date from its <head> when the page itself was not downloaded.
FETCH_PUBLISH_DATES = os.getenv("FETCH_PUBLISH_DATES", "true").strip().lower() == "true"

# --- Writing and verification (Phase 2) ---
WRITE_CHARS_PER_SOURCE = 1200   # most relevant passages per source sent to the writer (TPM limit)
HERMES_CHARS_PER_SOURCE = 400   # most relevant passages per source shown to Hermes
# How source passages are chosen for Hermes and the writers: "embedding" (default) or "keyword"
# (no embedding; for slow hosts such as Render free). Claim verification always uses embeddings.
PASSAGE_RANKING = os.getenv("PASSAGE_RANKING", "embedding").strip().lower()
# Sentences per cited source compared with each claim, picked by shared words; 0 = all (default).
VERIFY_MAX_SENTENCES = _int("VERIFY_MAX_SENTENCES", 0)
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
# "torch" (sentence-transformers, default) or "onnx" (fastembed: same model, no PyTorch, for 512 MB servers)
EMBED_BACKEND = os.getenv("EMBED_BACKEND", "torch").strip().lower()
# Load the embedding model in the background when a run starts (tools/embed.warm_up). On for Render.
EMBED_WARM_UP = os.getenv("EMBED_WARM_UP", "false").strip().lower() == "true"
EMBED_TIMEOUT_SECONDS = 120       # a stuck embedding call raises instead of hanging the run
VERIFY_TOP_K = 5               # passages per cited source shown to the verifier LLM
VERIFY_MAX_CLAIMS = 40          # cap on LLM verification calls per report; the rest are "unchecked"
VERIFY_WORKERS = _int("VERIFY_WORKERS", 4)  # claims checked at the same time (each mostly waits for the LLM)
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "output")

# --- Accounts (web app login) ---
# JWT_SECRET signs session tokens. Set it in .env (any long random string); if it is missing, a random
# secret is generated at startup, which works but signs everyone out whenever the server restarts.
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_TTL_HOURS = _int("JWT_TTL_HOURS", 12)

# --- Database (users and saved runs; see db.py) ---
# Postgres URL, e.g. Neon's "postgresql://user:password@host/dbname?sslmode=require". Empty = local SQLite.
DATABASE_URL = os.getenv("DATABASE_URL", "")
LOCAL_DB = os.getenv("LOCAL_DB", os.path.join(OUTPUT_DIR, "apollo.db"))
# Older local stores imported once into the database at startup (then no longer used).
LEGACY_USERS_DB = os.path.join(OUTPUT_DIR, "users.db")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"  # true when served over HTTPS

# Hard backstop for LangGraph itself, independent of our own round logic.
GRAPH_RECURSION_LIMIT = 25
