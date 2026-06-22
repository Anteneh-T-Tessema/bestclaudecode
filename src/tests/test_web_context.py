"""Tests for src/web_context.py."""
from src.web_context import (
    WebResult,
    format_web_block,
    fetch_web_context,
    parse_research_flag,
)


def _results(*titles: str) -> list[WebResult]:
    return [WebResult(title=t, url=f"https://example.com/{i}", snippet=f"Snippet for {t}") for i, t in enumerate(titles)]


# --- format_web_block -------------------------------------------------------

def test_format_web_block_header():
    block = format_web_block(_results("Foo"), "bm25 algorithm")
    assert "## Web research: bm25 algorithm" in block


def test_format_web_block_contains_title():
    block = format_web_block(_results("BM25 paper"), "bm25")
    assert "BM25 paper" in block


def test_format_web_block_contains_url():
    block = format_web_block(_results("Doc"), "bm25")
    assert "https://example.com" in block


def test_format_web_block_fenced():
    block = format_web_block(_results("X"), "q")
    assert "```" in block


def test_format_web_block_empty_results():
    block = format_web_block([], "nothing")
    assert "no results" in block
    assert "## Web research: nothing" in block


def test_format_web_block_caps_at_five():
    block = format_web_block(_results("A", "B", "C", "D", "E", "F", "G"), "q")
    assert block.count("[") <= 5  # at most 5 title brackets


def test_format_web_block_truncates_long_snippet():
    long_snippet = "\n".join(f"line {i}" for i in range(20))
    results = [WebResult(title="T", url="http://x.com", snippet=long_snippet)]
    block = format_web_block(results, "q")
    assert block.count("line") <= 8


# --- fetch_web_context -------------------------------------------------------

def test_fetch_web_context_no_fetcher_placeholder():
    block = fetch_web_context("git diff")
    assert "web fetcher not configured" in block
    assert "## Web research: git diff" in block


def test_fetch_web_context_with_fetcher():
    def mock_fetcher(q: str) -> list[WebResult]:
        return [WebResult(title=f"Result for {q}", url="http://x.com", snippet="desc")]

    block = fetch_web_context("bm25", fetcher=mock_fetcher)
    assert "Result for bm25" in block


def test_fetch_web_context_fetcher_caps_results():
    def many_fetcher(_: str) -> list[WebResult]:
        return _results("A", "B", "C", "D", "E", "F", "G")

    block = fetch_web_context("q", fetcher=many_fetcher, max_results=3)
    assert block.count("[") <= 3


def test_fetch_web_context_empty_fetcher():
    block = fetch_web_context("q", fetcher=lambda _: [])
    assert "no results" in block


# --- parse_research_flag -----------------------------------------------------

def test_parse_research_flag_extracts_query():
    query, rest = parse_research_flag(["--research", "BM25", "algorithm", "--deps", "add search"])
    assert query == "BM25 algorithm"
    assert rest == ["--deps", "add search"]


def test_parse_research_flag_no_flag():
    query, rest = parse_research_flag(["--deps", "add search"])
    assert query == ""
    assert rest == ["--deps", "add search"]


def test_parse_research_flag_at_end():
    query, rest = parse_research_flag(["add search", "--research", "git worktree"])
    assert query == "git worktree"
    assert rest == ["add search"]


def test_parse_research_flag_empty_args():
    query, rest = parse_research_flag([])
    assert query == ""
    assert rest == []


def test_parse_research_flag_single_token():
    query, rest = parse_research_flag(["--research", "BM25"])
    assert query == "BM25"
    assert rest == []


def test_parse_research_flag_stops_at_next_flag():
    query, rest = parse_research_flag(["--research", "foo", "--cached", "task text"])
    assert query == "foo"
    assert "--cached" in rest
    assert "task text" in rest
