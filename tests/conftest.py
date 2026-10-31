"""Test-wide safety net: tests must never call real APIs.

Every API key is blanked for each test, so any call that is not replaced by a
fake fails at once with ConfigError instead of spending quota (or waiting on
rate limits). The per-provider LLM client cache is cleared too, in case a client was built earlier.
"""

import pytest

import config
import llm
from tools import passages


@pytest.fixture(autouse=True)
def no_real_api_keys(monkeypatch):
    for name in ("TAVILY_API_KEY", "SERPER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.setattr(config, name, "")
    monkeypatch.setattr(llm, "_clients", {})
    monkeypatch.setattr(llm, "_cooling", {})  # a model marked out of quota must not leak between tests
    passages.clear_cache()  # embeddings cached by one test (with its fake model) must not leak into the next
