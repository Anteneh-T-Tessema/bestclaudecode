"""Tests for src/bm25_index.py."""
import json
from src.bm25_index import BM25Index, bm25_search

_REPO_MAP = """\
src/context.py
  def format_context() -- line 24
  def _build_header() -- line 10

src/diff_context.py
  def get_diff() -- line 33
  def format_context_with_diff() -- line 72

src/cache_manager.py
  class LRUCache -- line 8
  def evict() -- line 45
"""


# --- construction ----------------------------------------------------------

def test_from_repo_map_counts_docs():
    idx = BM25Index.from_repo_map(_REPO_MAP)
    assert len(idx) == 6  # 6 indented symbol lines


def test_empty_repo_map():
    idx = BM25Index.from_repo_map("")
    assert len(idx) == 0
    assert idx.search("anything") == []


def test_no_symbol_lines():
    idx = BM25Index.from_repo_map("src/foo.py\n")
    assert len(idx) == 0


# --- search ----------------------------------------------------------------

def test_search_returns_relevant_result():
    idx = BM25Index.from_repo_map(_REPO_MAP)
    results = idx.search("diff context")
    assert results, "expected at least one result"
    files = [r[1] for r in results]
    assert any("diff_context" in f for f in files)


def test_search_returns_at_most_top_k():
    idx = BM25Index.from_repo_map(_REPO_MAP)
    results = idx.search("context", top_k=2)
    assert len(results) <= 2


def test_search_sorted_descending():
    idx = BM25Index.from_repo_map(_REPO_MAP)
    results = idx.search("cache evict")
    scores = [r[0] for r in results]
    assert scores == sorted(scores, reverse=True)


def test_search_empty_query():
    idx = BM25Index.from_repo_map(_REPO_MAP)
    assert idx.search("") == []


def test_search_unknown_term():
    idx = BM25Index.from_repo_map(_REPO_MAP)
    # Stopwords only → no stems after tokenisation
    assert idx.search("the an a") == []


def test_bm25_scores_higher_than_zero():
    idx = BM25Index.from_repo_map(_REPO_MAP)
    results = idx.search("format context")
    assert all(score > 0 for score, _, _ in results)


# --- BM25 vs TF-IDF: saturation --------------------------------------------

def test_repeated_term_saturation():
    """BM25 with k1>0 gives diminishing returns for repeated terms."""
    repeated = "src/x.py\n  def cache_cache_cache_cache() -- line 1\n"
    single = "src/x.py\n  def cache() -- line 1\n"
    idx_rep = BM25Index.from_repo_map(repeated)
    idx_sin = BM25Index.from_repo_map(single)
    score_rep = idx_rep.search("cache")[0][0] if idx_rep.search("cache") else 0
    score_sin = idx_sin.search("cache")[0][0] if idx_sin.search("cache") else 0
    # Repeated term should NOT score 4× the single term (saturation)
    assert score_rep < score_sin * 4


# --- persistence -----------------------------------------------------------

def test_save_and_load(tmp_path):
    idx = BM25Index.from_repo_map(_REPO_MAP)
    p = tmp_path / "idx.json"
    idx.save(p)
    idx2 = BM25Index.load(p)
    assert len(idx2) == len(idx)
    r1 = idx.search("cache evict", top_k=3)
    r2 = idx2.search("cache evict", top_k=3)
    assert r1 == r2


def test_save_creates_parent_dirs(tmp_path):
    idx = BM25Index.from_repo_map(_REPO_MAP)
    p = tmp_path / "deep" / "nested" / "idx.json"
    idx.save(p)
    assert p.exists()


def test_load_roundtrip_json_structure(tmp_path):
    idx = BM25Index.from_repo_map(_REPO_MAP)
    p = tmp_path / "idx.json"
    idx.save(p)
    raw = json.loads(p.read_text())
    assert "docs" in raw and "df" in raw and "avg_dl" in raw and "n" in raw


# --- bm25_search helper ----------------------------------------------------

def test_bm25_search_returns_filtered_map():
    result = bm25_search(_REPO_MAP, "cache evict")
    assert "cache_manager" in result
    assert "def evict" in result


def test_bm25_search_fallback_on_no_results():
    result = bm25_search(_REPO_MAP, "zzznonexistent")
    assert result == _REPO_MAP


def test_bm25_search_groups_by_file():
    result = bm25_search(_REPO_MAP, "format context diff")
    lines = result.strip().splitlines()
    # File headers should appear before their symbol lines
    for i, line in enumerate(lines):
        if line.startswith("  "):
            assert any(
                not lines[j].startswith("  ") for j in range(i)
            ), "symbol line appeared before its file header"
