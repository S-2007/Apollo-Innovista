"""Single LLM client wrapper used by every agent (planning, review, writing, verification).

The default provider is LLM_PROVIDER in .env ("groq" or "gemini"). Callers
use `chat(system, user, temperature)` and get plain text back; JSON parsing
is done by the caller with tools.jsonparse.parse_json.

Each call has an HTTP timeout and a bounded number of retries on transient errors (tenacity), so a
slow or failing provider raises an exception instead of hanging. Callers are
expected to catch that exception and fall back.

`provider` / `model` override the defaults for one call. Claim verification uses
this to walk a fallback chain (Groq 20b -> Groq 120b -> Gemini), because each has
its own quota. gpt-oss models are called with reasoning_effort="low": their hidden
reasoning tokens count against Groq's token limits.
"""

import config
from tools.retry_policy import ConfigError, with_retries

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


@with_retries(config.LLM_MAX_RETRIES)
def chat(
    system: str, user: str, temperature: float = 0.2, model: str | None = None, provider: str | None = None
) -> str:
    """Send one system+user prompt and return the model's text reply."""
    provider = provider or config.LLM_PROVIDER
    client = _get_client(provider)
    if provider == "groq":
        name = model or config.GROQ_MODEL
        extra = {"reasoning_effort": "low"} if name.startswith("openai/gpt-oss") else {}
        resp = client.chat.completions.create(
            model=name,
            temperature=temperature,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            **extra,
        )
        return resp.choices[0].message.content or ""

    from google.genai import types

    resp = client.models.generate_content(
        model=model or config.GEMINI_MODEL,
        contents=user,
        config=types.GenerateContentConfig(system_instruction=system, temperature=temperature),
    )
    return resp.text or ""
