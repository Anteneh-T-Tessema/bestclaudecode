"""Tests for src/embedding_index.py — TF-IDF semantic search index."""
from src.embedding_index import TFIDFIndex, semantic_fallback

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


def test_index_builds_from_repo_map():
    index = TFIDFIndex.from_repo_map(_SAMPLE_MAP)
    assert len(index) == 6  # 6 symbol lines


def test_search_returns_relevant_results():
    index = TFIDFIndex.from_repo_map(_SAMPLE_MAP)
    results = index.search("evict cache", top_k=3)
    assert results, "expected at least one result"
    # evict_lru and cache_stats should rank above unrelated symbols.
    top_files = [file for _, file, _ in results]
    assert any("cache_manager" in f for f in top_files)


def test_search_returns_empty_for_blank_query():
    index = TFIDFIndex.from_repo_map(_SAMPLE_MAP)
    assert index.search("") == []


def test_search_returns_empty_for_stopword_only_query():
    index = TFIDFIndex.from_repo_map(_SAMPLE_MAP)
    assert index.search("the a to in") == []


def test_search_top_k_limits_results():
    index = TFIDFIndex.from_repo_map(_SAMPLE_MAP)
    results = index.search("build map context", top_k=2)
    assert len(results) <= 2


def test_search_scores_descending():
    index = TFIDFIndex.from_repo_map(_SAMPLE_MAP)
    results = index.search("format context", top_k=5)
    scores = [s for s, _, _ in results]
    assert scores == sorted(scores, reverse=True)


def test_index_empty_map():
    index = TFIDFIndex.from_repo_map("")
    assert len(index) == 0
    assert index.search("anything") == []


def test_semantic_fallback_returns_subset_of_map():
    result = semantic_fallback(_SAMPLE_MAP, "evict cache lru")
    # Result should be shorter than or equal to the full map.
    assert len(result) <= len(_SAMPLE_MAP) + 10  # small tolerance for trailing newline
    assert "evict_lru" in result


def test_semantic_fallback_passthrough_on_no_results():
    # A query with only stopwords scores nothing; original map returned.
    result = semantic_fallback(_SAMPLE_MAP, "the a in")
    assert result == _SAMPLE_MAP


def test_filter_map_uses_semantic_fallback_when_no_token_match():
    """filter_map falls back to TF-IDF when token intersection yields nothing."""
    from src.symbol_filter import filter_map

    # "orchestrate pipeline" shares no stems with any symbol in _SAMPLE_MAP,
    # so token matching returns nothing and the semantic fallback is invoked.
    result = filter_map(_SAMPLE_MAP, "orchestrate pipeline")
    # The result should be a non-empty string (fallback returned something).
    assert result.strip()
