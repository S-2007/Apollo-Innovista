"""Shared sentence-embedding model (all-MiniLM-L6-v2).

embed(texts) -> L2-normalised numpy array, so a dot product is cosine similarity.
Used by tools/passages.py (choosing relevant source passages) and
verify/claims.py (claim matching).

Two backends run the SAME model (config.EMBED_BACKEND):
  torch : sentence-transformers + PyTorch (default; what local development uses)
  onnx  : fastembed + ONNX Runtime, no PyTorch. For small servers (e.g. Render free, 512 MB).
          Measured on a saved run: identical vectors (cosine 1.0000), same best-matching
          sentences and the same VERIFY_PARTIAL_SIM decisions as the torch backend.

Threading: the section writers run in parallel threads (LangGraph Send), and
verification runs on yet another thread. Using one torch model from several
threads crashed the process (segmentation fault) and, even when serialised
with a lock, later hung when a different thread called it (torch's internal
thread pool on Windows). So the model lives on ONE dedicated worker thread:
embed() hands the work to that thread and waits for the result. The slow LLM
calls in the writers still run in parallel; only embedding is single-threaded.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import config

_model = None
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="embed")


class _OnnxModel:
    """fastembed's TextEmbedding behind the same encode() call as SentenceTransformer.

    Small batches and two threads keep memory low: with fastembed's defaults (batch 256) the
    process peaked at 461 MB embedding 2,000 sentences; with these it peaks around 225 MB for the
    model, at about 10 s per 2,000 sentences."""

    BATCH_SIZE = 32
    THREADS = 2

    def __init__(self, name: str):
        from fastembed import TextEmbedding

        self._model = TextEmbedding(model_name=name, threads=self.THREADS)

    def encode(self, texts: list[str], normalize_embeddings: bool = True, show_progress_bar: bool = False):
        vecs = np.array(list(self._model.embed(texts, batch_size=self.BATCH_SIZE)), dtype=np.float32)
        if normalize_embeddings and len(vecs):
            vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
        return vecs


def _encode(texts: list[str]):
    global _model
    if _model is None:  # only ever touched on the worker thread
        if config.EMBED_BACKEND == "onnx":
            _model = _OnnxModel(config.EMBED_MODEL)
        else:
            from sentence_transformers import SentenceTransformer

            _model = SentenceTransformer(config.EMBED_MODEL)
    return _model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


# text -> its vector. The same sentences are embedded for Hermes' passages, the section writers and
# claim verification; each is now computed once per run. Same model, same vectors: only the repeat
# work goes away (it dominates on small servers such as Render's 0.1 CPU).
_vectors: dict[str, np.ndarray] = {}
_cache_lock = threading.Lock()
MAX_CACHED = 50_000  # about 75 MB of float32 vectors; cleared at the start of every run anyway


def clear_cache() -> None:
    with _cache_lock:
        _vectors.clear()


def embed(texts: list[str]):
    with _cache_lock:
        have = {t: _vectors[t] for t in texts if t in _vectors}
    missing = [t for t in dict.fromkeys(texts) if t not in have]
    if missing:
        new = dict(zip(missing, _worker.submit(_encode, missing).result(timeout=config.EMBED_TIMEOUT_SECONDS)))
        have.update(new)
        with _cache_lock:
            if len(_vectors) + len(new) > MAX_CACHED:
                _vectors.clear()
            _vectors.update(new)
    return np.array([have[t] for t in texts])
