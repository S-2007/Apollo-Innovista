"""EMBED_BACKEND: "onnx" uses fastembed (no torch) through the same embed() call. Offline: fastembed is faked."""

import sys
import types

import numpy as np
import pytest

import config
from tools import embed as embed_mod


@pytest.fixture(autouse=True)
def fresh_model(monkeypatch):
    monkeypatch.setattr(embed_mod, "_model", None)
    yield
    embed_mod._model = None


def test_onnx_backend_uses_fastembed_and_normalises(monkeypatch):
    seen = {}

    class FakeTextEmbedding:
        def __init__(self, model_name, threads=None):
            seen["model"], seen["threads"] = model_name, threads

        def embed(self, texts, batch_size=256):
            seen["batch_size"] = batch_size
            return iter([np.array([3.0, 4.0]) for _ in texts])  # length 5: must come back as length 1

    monkeypatch.setitem(sys.modules, "fastembed", types.SimpleNamespace(TextEmbedding=FakeTextEmbedding))
    monkeypatch.setattr(config, "EMBED_BACKEND", "onnx")
    vecs = embed_mod.embed(["a", "b"])
    assert vecs.shape == (2, 2) and np.allclose(np.linalg.norm(vecs, axis=1), 1.0)
    assert np.allclose(vecs[0], [0.6, 0.8])
    assert seen == {"model": config.EMBED_MODEL, "threads": 2, "batch_size": 32}  # low-memory settings


def test_default_backend_is_sentence_transformers(monkeypatch):
    class FakeST:
        def __init__(self, name):
            self.name = name

        def encode(self, texts, normalize_embeddings, show_progress_bar):
            return np.ones((len(texts), 3))

    monkeypatch.setitem(sys.modules, "sentence_transformers", types.SimpleNamespace(SentenceTransformer=FakeST))
    monkeypatch.setitem(sys.modules, "fastembed", None)  # importing it would fail: the default must not need it
    monkeypatch.setattr(config, "EMBED_BACKEND", "torch")
    assert embed_mod.embed(["x"]).shape == (1, 3)
    assert isinstance(embed_mod._model, FakeST)
