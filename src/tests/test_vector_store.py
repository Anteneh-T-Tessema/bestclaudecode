"""Tests for src/vector_store.py — Qdrant-backed persistent vector storage.

These run against a REAL qdrant_client in embedded local-file mode (no
Docker, no server) — not a mock. is_available() gates the whole module on
qdrant-client being installed (see pyproject.toml's vector-store extra).
"""
import pytest

from src.vector_store import VectorStore, is_available

pytestmark = pytest.mark.skipif(not is_available(), reason="qdrant-client not installed")


def test_open_creates_local_store(tmp_path):
    store = VectorStore.open(vector_size=4, local_path=tmp_path / "qdrant")
    assert store.count() == 0


def test_upsert_then_search_returns_closest_point(tmp_path):
    store = VectorStore.open(vector_size=4, local_path=tmp_path / "qdrant")
    store.upsert([
        (1, [1.0, 0.0, 0.0, 0.0], {"file": "a.py", "text": "def evict_lru()"}),
        (2, [0.0, 1.0, 0.0, 0.0], {"file": "b.py", "text": "def unrelated()"}),
    ])

    results = store.search([0.9, 0.1, 0.0, 0.0], top_k=2)

    assert len(results) == 2
    top_score, top_payload = results[0]
    assert top_payload["file"] == "a.py"
    assert results[0][0] >= results[1][0]  # highest score first


def test_upsert_with_empty_points_is_a_noop(tmp_path):
    store = VectorStore.open(vector_size=4, local_path=tmp_path / "qdrant")
    store.upsert([])
    assert store.count() == 0


def test_upsert_overwrites_existing_point_with_same_id(tmp_path):
    store = VectorStore.open(vector_size=4, local_path=tmp_path / "qdrant")
    store.upsert([(1, [1.0, 0.0, 0.0, 0.0], {"file": "a.py"})])
    store.upsert([(1, [0.0, 1.0, 0.0, 0.0], {"file": "a-updated.py"})])

    assert store.count() == 1
    results = store.search([0.0, 1.0, 0.0, 0.0], top_k=1)
    assert results[0][1]["file"] == "a-updated.py"


def test_clear_removes_all_points(tmp_path):
    store = VectorStore.open(vector_size=4, local_path=tmp_path / "qdrant")
    store.upsert([(1, [1.0, 0.0, 0.0, 0.0], {"file": "a.py"})])
    assert store.count() == 1

    store.clear()
    assert store.count() == 0


def test_count_reflects_number_of_points(tmp_path):
    store = VectorStore.open(vector_size=4, local_path=tmp_path / "qdrant")
    store.upsert([
        (1, [1.0, 0.0, 0.0, 0.0], {"file": "a.py"}),
        (2, [0.0, 1.0, 0.0, 0.0], {"file": "b.py"}),
        (3, [0.0, 0.0, 1.0, 0.0], {"file": "c.py"}),
    ])
    assert store.count() == 3


def test_reopening_the_same_local_path_preserves_data(tmp_path):
    path = tmp_path / "qdrant"
    store1 = VectorStore.open(vector_size=4, local_path=path)
    store1.upsert([(1, [1.0, 0.0, 0.0, 0.0], {"file": "a.py"})])
    del store1

    store2 = VectorStore.open(vector_size=4, local_path=path)
    assert store2.count() == 1


def test_is_available_returns_true_when_installed():
    # This test only runs at all when is_available() is True (pytestmark
    # skip), so it's really asserting the function is consistent with itself.
    assert is_available() is True
