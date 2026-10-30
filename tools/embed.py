"""Shared sentence-embedding model (sentence-transformers all-MiniLM-L6-v2).

embed(texts) -> L2-normalised numpy array, so a dot product is cosine similarity.
Used by tools/passages.py (choosing relevant source passages) and
verify/claims.py (claim matching).

Threading: the section writers run in parallel threads (LangGraph Send), and
verification runs on yet another thread. Using one torch model from several
threads crashed the process (segmentation fault) and, even when serialised
with a lock, later hung when a different thread called it (torch's internal
thread pool on Windows). So the model lives on ONE dedicated worker thread:
embed() hands the work to that thread and waits for the result. The slow LLM
calls in the writers still run in parallel; only embedding is single-threaded.
"""

from concurrent.futures import ThreadPoolExecutor

import config

_model = None
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="embed")


def _encode(texts: list[str]):
    global _model
    if _model is None:  # only ever touched on the worker thread
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(config.EMBED_MODEL)
    return _model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


def embed(texts: list[str]):
    return _worker.submit(_encode, texts).result(timeout=config.EMBED_TIMEOUT_SECONDS)
