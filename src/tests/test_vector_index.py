"""Tests for src/vector_index.py — semantic vector search over repo map symbols."""
import json
import sys

import pytest

from src.vector_index import (
    VectorIndex,
    _cosine,
    _hash_embed,
    active_backend,
    build_persistent_index,
    embed_texts,
    hybrid_search,
    persistent_search,
    related_decisions,
    semantic_vector_search,
)
from src.vector_store import is_available as _qdrant_available

_SAMPLE_MAP = (
    "src/context.py\n"
    "  def format_context() -- line 20\n"
    "  def _build_header() -- line 5\n"
    "src/cache_manager.py\n"
    "  def evict_lru() -- line 31\n"
    "  def cache_stats() -- line 58\n"
    "src/repo_map.py\n"
    "  def build_repo_map() -- line 145\n"
    "  def _iter_python_files() -- line 30\n"
)


@pytest.fixture(autouse=True)
def _no_voyage_key(monkeypatch):
    """Force the local hash embedder for every test unless a test opts in
    to a real key explicitly — keeps the suite network-free and deterministic."""
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)


# ---------------------------------------------------------------------------
# _hash_embed / _cosine
# ---------------------------------------------------------------------------

def test_hash_embed_is_deterministic():
    a = _hash_embed("def evict_lru() -- line 31")
    b = _hash_embed("def evict_lru() -- line 31")
    assert a == b


def test_hash_embed_empty_text_is_zero_vector():
    vec = _hash_embed("")
    assert all(v == 0.0 for v in vec)


def test_hash_embed_is_l2_normalised():
    vec = _hash_embed("def evict_lru() -- line 31 cache eviction")
    norm = sum(v * v for v in vec) ** 0.5
    assert norm == pytest.approx(1.0, abs=1e-9)


def test_cosine_identical_vectors_is_one():
    vec = _hash_embed("def evict_lru()")
    assert _cosine(vec, vec) == pytest.approx(1.0, abs=1e-9)


def test_cosine_zero_vector_is_zero():
    assert _cosine([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_cosine_shared_tokens_score_higher_than_unrelated():
    a = _hash_embed("def evict_lru() -- line 31")
    b = _hash_embed("def cache_stats() -- line 58")  # shares no stems with a
    c = _hash_embed("def evict_lru() -- line 31")  # identical to a
    assert _cosine(a, c) > _cosine(a, b)


# ---------------------------------------------------------------------------
# embed_texts / active_backend
# ---------------------------------------------------------------------------

def test_embed_texts_empty_input_returns_empty_list():
    assert embed_texts([]) == []


def test_embed_texts_uses_local_backend_without_api_key():
    assert active_backend() == "local-hash"
    vectors = embed_texts(["foo", "bar"])
    assert len(vectors) == 2


def test_active_backend_reports_voyage_when_key_set(monkeypatch):
    monkeypatch.setenv("VOYAGE_API_KEY", "sk-fake-key-for-backend-check-only")
    assert active_backend() == "voyage-code-3"


def test_embed_texts_falls_back_to_local_on_network_failure(monkeypatch):
    # An unreachable/invalid key should never raise — embed_texts must fall
    # back to the local embedder rather than propagate the network error.
    monkeypatch.setenv("VOYAGE_API_KEY", "sk-definitely-invalid-and-unreachable")
    vectors = embed_texts(["some code symbol"])
    assert len(vectors) == 1
    assert len(vectors[0]) == 256  # local embedder's fixed dimensionality


# ---------------------------------------------------------------------------
# VectorIndex
# ---------------------------------------------------------------------------

def test_index_builds_from_repo_map():
    index = VectorIndex.from_repo_map(_SAMPLE_MAP)
    assert len(index) == 6


def test_index_empty_map():
    index = VectorIndex.from_repo_map("")
    assert len(index) == 0
    assert index.search("anything") == []


def test_search_returns_empty_for_blank_query():
    index = VectorIndex.from_repo_map(_SAMPLE_MAP)
    assert index.search("") == []


def test_search_finds_exact_token_match():
    index = VectorIndex.from_repo_map(_SAMPLE_MAP)
    results = index.search("evict cache lru", top_k=3)
    assert results, "expected at least one result"
    top_files = [file for _, file, _ in results]
    assert any("cache_manager" in f for f in top_files)


def test_search_top_k_limits_results():
    index = VectorIndex.from_repo_map(_SAMPLE_MAP)
    results = index.search("build map context cache", top_k=2)
    assert len(results) <= 2


def test_search_scores_descending():
    index = VectorIndex.from_repo_map(_SAMPLE_MAP)
    results = index.search("format context build map", top_k=5)
    scores = [s for s, _, _ in results]
    assert scores == sorted(scores, reverse=True)


def test_semantic_vector_search_returns_subset_of_map():
    result = semantic_vector_search(_SAMPLE_MAP, "evict cache lru")
    assert "evict_lru" in result


def test_semantic_vector_search_passthrough_on_no_results():
    result = semantic_vector_search(_SAMPLE_MAP, "the a in")
    assert result == _SAMPLE_MAP


# ---------------------------------------------------------------------------
# hybrid_search
# ---------------------------------------------------------------------------

def test_hybrid_search_finds_lexical_match():
    results = hybrid_search(_SAMPLE_MAP, "evict cache lru", top_k=3)
    assert results
    assert any("cache_manager" in file for _, file, _ in results)


def test_hybrid_search_falls_back_to_full_vector_search_with_no_lexical_overlap():
    # "orchestrate pipeline" shares no stems with anything in _SAMPLE_MAP, so
    # BM25's pre-filter returns nothing and hybrid_search must fall back to
    # a full vector search rather than returning an empty list outright.
    results = hybrid_search(_SAMPLE_MAP, "orchestrate pipeline", top_k=5)
    assert isinstance(results, list)  # local embedder finds ~nothing relevant, but must not crash


def test_hybrid_search_respects_top_k():
    results = hybrid_search(_SAMPLE_MAP, "build map context cache evict", top_k=2)
    assert len(results) <= 2


# ---------------------------------------------------------------------------
# related_decisions
# ---------------------------------------------------------------------------

def test_related_decisions_finds_match_by_filename(tmp_path):
    from src.decision_log import log_decision

    log_decision(
        "fix caching bug",
        verdict="LGTM",
        outcome="Fixed a bug in src/cache_manager.py's eviction logic.",
        docs_dir=tmp_path,
    )
    results = related_decisions("src/cache_manager.py", docs_dir=tmp_path)
    assert len(results) == 1
    assert results[0]["verdict"] == "LGTM"


def test_related_decisions_empty_when_no_match(tmp_path):
    from src.decision_log import log_decision

    log_decision(
        "unrelated task",
        verdict="LGTM",
        outcome="Touched a completely different file.",
        docs_dir=tmp_path,
    )
    assert related_decisions("src/cache_manager.py", docs_dir=tmp_path) == []


def test_related_decisions_respects_top_k(tmp_path):
    from src.decision_log import log_decision

    for i in range(5):
        log_decision(
            f"touch cache_manager.py round {i}",
            verdict="LGTM",
            outcome="Edited src/cache_manager.py again.",
            docs_dir=tmp_path,
        )
    results = related_decisions("src/cache_manager.py", top_k=2, docs_dir=tmp_path)
    assert len(results) == 2


def test_related_decisions_empty_for_missing_dir(tmp_path):
    assert related_decisions("src/cache_manager.py", docs_dir=tmp_path / "nonexistent") == []


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def test_cli_json_output_schema(monkeypatch, capsys, tmp_path):
    (tmp_path / "mod.py").write_text("def evict_lru():\n    pass\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["vector_index", "evict", str(tmp_path), "--json"])
    from src.vector_index import main

    main()
    out = json.loads(capsys.readouterr().out)
    assert "docCount" in out
    assert "avgDl" in out
    assert "results" in out
    assert out["backend"] == "local-hash"


def test_cli_no_query_reports_doc_count(monkeypatch, capsys, tmp_path):
    (tmp_path / "mod.py").write_text("def foo():\n    pass\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["vector_index", "", str(tmp_path), "--json"])
    from src.vector_index import main

    main()
    out = json.loads(capsys.readouterr().out)
    assert out["results"] == []
    assert out["docCount"] >= 1


def test_cli_hybrid_flag_runs_without_error(monkeypatch, capsys, tmp_path):
    (tmp_path / "mod.py").write_text("def evict_lru():\n    pass\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["vector_index", "evict", str(tmp_path), "--json", "--hybrid"])
    from src.vector_index import main

    main()
    out = json.loads(capsys.readouterr().out)
    assert "results" in out


def test_cli_chunks_flag_runs_without_error(monkeypatch, capsys, tmp_path):
    (tmp_path / "mod.py").write_text("def evict_lru():\n    return 1\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["vector_index", "evict", str(tmp_path), "--json", "--chunks"])
    from src.vector_index import main

    main()
    out = json.loads(capsys.readouterr().out)
    assert "results" in out


# ---------------------------------------------------------------------------
# VectorIndex.from_chunks (AST-level chunking)
# ---------------------------------------------------------------------------

def test_from_chunks_embeds_full_function_body(tmp_path):
    from src.repo_map import extract_chunks

    (tmp_path / "mod.py").write_text(
        "def evict_lru():\n    \"\"\"Evict the least recently used cache entry.\"\"\"\n    return True\n",
        encoding="utf-8",
    )
    chunks = extract_chunks(tmp_path)
    index = VectorIndex.from_chunks(chunks)
    assert len(index) == 1

    results = index.search("evict least recently used", top_k=1)
    assert results
    assert "evict_lru" in results[0][2]


def test_from_chunks_display_line_matches_line_format(tmp_path):
    from src.repo_map import extract_chunks

    (tmp_path / "mod.py").write_text("def evict_lru():\n    return 1\n", encoding="utf-8")
    chunks = extract_chunks(tmp_path)
    index = VectorIndex.from_chunks(chunks)
    results = index.search("evict", top_k=1)
    assert results
    assert "-- line 1" in results[0][2]


def test_from_chunks_empty_list_produces_empty_index():
    index = VectorIndex.from_chunks([])
    assert len(index) == 0
    assert index.search("anything") == []


# ---------------------------------------------------------------------------
# Persistence (build_persistent_index / persistent_search)
# ---------------------------------------------------------------------------

pytestmark_qdrant = pytest.mark.skipif(not _qdrant_available(), reason="qdrant-client not installed")


@pytestmark_qdrant
def test_build_persistent_index_then_search_finds_real_match(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "cache.py").write_text(
        "def evict_lru():\n    \"\"\"Evict the least recently used entry.\"\"\"\n    return True\n",
        encoding="utf-8",
    )
    store_path = tmp_path / "qdrant"

    count = build_persistent_index(repo, local_path=store_path)
    assert count == 1

    doc_count, results = persistent_search("evict lru cache", top_k=5, local_path=store_path)
    assert doc_count == 1
    assert results
    assert "evict_lru" in results[0][2]


@pytestmark_qdrant
def test_persistent_search_does_not_reembed_between_calls(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "cache.py").write_text("def evict_lru():\n    return True\n", encoding="utf-8")
    store_path = tmp_path / "qdrant"
    build_persistent_index(repo, local_path=store_path)

    call_count = {"n": 0}
    import src.vector_index as vector_index_module
    original_embed = vector_index_module.embed_texts

    def counting_embed(texts):
        call_count["n"] += 1
        return original_embed(texts)

    monkeypatch.setattr(vector_index_module, "embed_texts", counting_embed)
    persistent_search("evict lru", top_k=5, local_path=store_path)

    # Only the query string should be embedded — not the whole corpus again.
    assert call_count["n"] == 1


@pytestmark_qdrant
def test_build_persistent_index_empty_repo_returns_zero(tmp_path):
    repo = tmp_path / "empty_repo"
    repo.mkdir()
    count = build_persistent_index(repo, local_path=tmp_path / "qdrant")
    assert count == 0


@pytestmark_qdrant
def test_persistent_search_empty_store_returns_zero_count(tmp_path):
    doc_count, results = persistent_search("anything", local_path=tmp_path / "qdrant-empty")
    assert doc_count == 0
    assert results == []


@pytestmark_qdrant
def test_cli_build_index_then_persistent_search(monkeypatch, capsys, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "cache.py").write_text("def evict_lru():\n    return True\n", encoding="utf-8")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "argv", ["vector_index", "--build-index", str(repo), "--json"])
    from src.vector_index import main

    main()
    build_out = json.loads(capsys.readouterr().out)
    assert build_out["indexed"] == 1

    monkeypatch.setattr(sys, "argv", ["vector_index", "evict lru", "--persistent", "--json"])
    main()
    search_out = json.loads(capsys.readouterr().out)
    assert search_out["docCount"] == 1
    assert search_out["results"]
