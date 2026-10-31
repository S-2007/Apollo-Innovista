"""Single LLM client wrapper used by every agent (planning, review, writing, verification).

The default provider is LLM_PROVIDER in .env ("groq" or "gemini"). Callers
use `chat(system, user, temperature)` and get plain text back; JSON parsing
is done by the caller with tools.jsonparse.parse_json.

Each call has an HTTP timeout and a bounded number of retries on transient errors (tenacity), so a
slow or failing provider raises an exception instead of hanging. Callers are
expected to catch that exception and fall back.

Without `provider` / `model`, a call walks config.LLM_CHAIN (LLM_PROVIDER's model first, then
the others), so one model's spent quota or rate-limit burst does not fail planning, review or
writing. `provider` / `model` pin one model for a call; claim verification uses this to walk
its own chain (Groq 20b -> Groq 120b -> Gemini), because each has its own quota. gpt-oss models are called with reasoning_effort="low": their hidden
reasoning tokens count against Groq's token limits.
"""

import time

import config
import metering
from tools.retry_policy import ConfigError, is_quota_exhausted, with_retries

_clients: dict[str, object] = {}


def _get_client(provider: str):
    """Create each provider's client lazily so importing this module never needs keys."""
    if provider in _clients:
        return _clients[provider]
    if provider == "groq":
        if not config.GROQ_API_KEY:
            raise ConfigError("GROQ_API_KEY is not set")
        from groq import Groq

        client = Groq(api_key=config.GROQ_API_KEY, timeout=config.REQUEST_TIMEOUT_SECONDS * 2, max_retries=0)
    elif provider == "gemini":
        if not config.GEMINI_API_KEY:
            raise ConfigError("GEMINI_API_KEY is not set")
        from google import genai
        from google.genai import types

        client = genai.Client(
            api_key=config.GEMINI_API_KEY,
            http_options=types.HttpOptions(timeout=config.REQUEST_TIMEOUT_SECONDS * 2 * 1000),
        )
    else:
        raise ConfigError(f"Unknown LLM provider: {provider!r}")
    _clients[provider] = client
    return client


_cooling: dict[tuple[str, str], float] = {}  # (provider, model) -> monotonic time its quota may be back
_KEYS = {"groq": lambda: config.GROQ_API_KEY, "gemini": lambda: config.GEMINI_API_KEY}


def chat(
    system: str, user: str, temperature: float = 0.2, model: str | None = None, provider: str | None = None
) -> str:
    """Send one system+user prompt and return the model's text reply.

    With no provider/model given, walk config.LLM_CHAIN: a model whose call still fails after its
    retries (spent quota, rate-limit burst, outage) hands the call to the next model. A model whose
    DAILY quota is spent is skipped for LLM_COOLDOWN_SECONDS. With an explicit provider/model (claim
    verification runs its own chain) exactly that model is used."""
    if provider or model:
        provider = provider or config.LLM_PROVIDER
        return _chat_one(provider, model or (config.GROQ_MODEL if provider == "groq" else config.GEMINI_MODEL), system, user, temperature)

    now = time.monotonic()
    keyed = [(p, m) for p, m in dict.fromkeys(config.LLM_CHAIN) if _KEYS.get(p, lambda: "")()]
    # No key anywhere: still try the first entry, so the caller gets that provider's own ConfigError.
    candidates = [c for c in keyed if _cooling.get(c, 0) <= now] or keyed[:1] or config.LLM_CHAIN[:1]
    last: Exception | None = None
    for p, m in candidates:
        try:
            return _chat_one(p, m, system, user, temperature)
        except Exception as exc:
            if is_quota_exhausted(exc):
                _cooling[(p, m)] = time.monotonic() + config.LLM_COOLDOWN_SECONDS
            last = exc  # try the next model; the meter already recorded this failure
    raise last if last else ConfigError("LLM_CHAIN is empty")


@with_retries(config.LLM_MAX_RETRIES)
def _chat_one(provider: str, name: str, system: str, user: str, temperature: float) -> str:
    """One model, with retries on transient errors. Every attempt (including failed ones) is
    recorded in the usage meter, with token counts as reported by the provider."""
    started = time.monotonic()
    try:
        text, prompt_tokens, completion_tokens = _call(provider, name, system, user, temperature)
    except Exception as exc:
        metering.record("llm", False, time.monotonic() - started, provider=provider, model=name,
                        error=f"{type(exc).__name__}: {str(exc)[:400]}")
        raise
    metering.record("llm", True, time.monotonic() - started, provider=provider, model=name,
                    prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
    return text


def _call(provider: str, name: str, system: str, user: str, temperature: float) -> tuple[str, int, int]:
    """One provider call: (reply text, prompt tokens, completion tokens)."""
    client = _get_client(provider)
    if provider == "groq":
        extra = {"reasoning_effort": "low"} if name.startswith("openai/gpt-oss") else {}
        resp = client.chat.completions.create(
            model=name,
            temperature=temperature,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            **extra,
        )
        usage = getattr(resp, "usage", None)
        return (resp.choices[0].message.content or "",
                getattr(usage, "prompt_tokens", 0) or 0, getattr(usage, "completion_tokens", 0) or 0)

    from google.genai import types

    resp = client.models.generate_content(
        model=name,
        contents=user,
        config=types.GenerateContentConfig(system_instruction=system, temperature=temperature),
    )
    usage = getattr(resp, "usage_metadata", None)
    # Gemini bills thinking tokens as output, so they are counted with the completion.
    completion = (getattr(usage, "candidates_token_count", 0) or 0) + (getattr(usage, "thoughts_token_count", 0) or 0)
    return resp.text or "", getattr(usage, "prompt_token_count", 0) or 0, completion
