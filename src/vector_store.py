"""Persistent vector storage for src.vector_index — Qdrant-backed.

Without this module, src.vector_index recomputes every embedding on every
search call. That's fine for the local hashing-trick embedder (free, no
network) but wasteful and slow once VOYAGE_API_KEY is set — re-embedding
the whole repo on every query means paying for and waiting on hundreds of
API calls per search. This module lets callers build the index once and
search it many times.

Qdrant runs in two modes through the *same* client API:

  - **Embedded local mode** — ``QdrantClient(path=...)``: a local on-disk
    store, no server, no Docker. Zero infrastructure cost; the default.
  - **Remote mode** — ``QdrantClient(url=...)``: Qdrant Cloud or a
    self-hosted server, selected automatically when ``QDRANT_URL`` is set.

``qdrant-client`` is an optional dependency (see pyproject.toml's
``vector-store`` extra) — imported lazily so importing this module, or
src.vector_index, never fails just because it isn't installed. Callers get
a clear ImportError only if they actually try to open a store.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

_DEFAULT_LOCAL_PATH = Path(".cache") / "qdrant"
_COLLECTION = "lakoora_symbols"


def is_available() -> bool:
    """Return True if qdrant_client is importable, without importing it eagerly."""
    try:
        import qdrant_client  # noqa: F401
    except ImportError:
        return False
    return True


class VectorStore:
    """Thin wrapper around qdrant_client for symbol-chunk persistence.

    Construct with VectorStore.open(vector_size) rather than directly —
    the constructor assumes the collection already exists.
    """

    def __init__(self, client: Any, vector_size: int) -> None:
        self._client = client
        self._vector_size = vector_size
        self._ensure_collection()

    @classmethod
    def open(cls, vector_size: int, local_path: Path | None = None) -> "VectorStore":
        """Open (creating on first use) a vector store.

        Uses QDRANT_URL (+ optional QDRANT_API_KEY) for remote mode if set,
        otherwise an embedded local-file store at local_path
        (default .cache/qdrant/, relative to the current working directory).
        """
        from qdrant_client import QdrantClient

        url = os.environ.get("QDRANT_URL")
        if url:
            client = QdrantClient(url=url, api_key=os.environ.get("QDRANT_API_KEY"))
        else:
            path = local_path or _DEFAULT_LOCAL_PATH
            path.mkdir(parents=True, exist_ok=True)
            client = QdrantClient(path=str(path))
        return cls(client, vector_size)

    def _ensure_collection(self) -> None:
        from qdrant_client.models import Distance, VectorParams

        if not self._client.collection_exists(_COLLECTION):
            self._client.create_collection(
                collection_name=_COLLECTION,
                vectors_config=VectorParams(size=self._vector_size, distance=Distance.COSINE),
            )

    def upsert(self, points: list[tuple[int, list[float], dict[str, Any]]]) -> None:
        """Insert or update points. Each point is (id, vector, payload)."""
        from qdrant_client.models import PointStruct

        if not points:
            return
        self._client.upsert(
            collection_name=_COLLECTION,
            points=[PointStruct(id=pid, vector=vector, payload=payload) for pid, vector, payload in points],
        )

    def search(self, query_vector: list[float], top_k: int = 5) -> list[tuple[float, dict[str, Any]]]:
        """Return up to top_k (score, payload) pairs, highest score first."""
        result = self._client.query_points(collection_name=_COLLECTION, query=query_vector, limit=top_k)
        return [(point.score, point.payload or {}) for point in result.points]

    def clear(self) -> None:
        """Delete and recreate the collection — used when rebuilding the index from scratch."""
        self._client.delete_collection(_COLLECTION)
        self._ensure_collection()

    def count(self) -> int:
        """Return the number of points currently stored."""
        return self._client.count(collection_name=_COLLECTION).count
