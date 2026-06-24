"""Tests for src/chat_context.py — hybrid search + snippet enrichment for chat/agent prompts."""
import json
import sys
from pathlib import Path

import pytest

from src.chat_context import build_chat_context, _extract_line_number, _read_snippet


@pytest.fixture(autouse=True)
def _no_voyage_key(monkeypatch):
    """Force the local hash embedder for every test — keeps the suite
    network-free and deterministic, same convention as test_vector_index.py."""
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)


# ---------------------------------------------------------------------------
# _extract_line_number
# ---------------------------------------------------------------------------

def test_extract_line_number_finds_suffix():
    assert _extract_line_number("def evict_lru() -- line 31") == 31


def test_extract_line_number_missing_suffix_returns_none():
    assert _extract_line_number("def evict_lru()") is None


# ---------------------------------------------------------------------------
# _read_snippet
# ---------------------------------------------------------------------------

def test_read_snippet_returns_surrounding_lines(tmp_path):
    f = tmp_path / "mod.py"
    f.write_text("\n".join(f"line{i}" for i in range(1, 11)), encoding="utf-8")

    snippet = _read_snippet(str(f), 5, context=2)

    assert "line5" in snippet
    assert "line3" in snippet
    assert "line7" in snippet


def test_read_snippet_missing_file_returns_empty_string():
    assert _read_snippet("/nonexistent/path/mod.py", 1) == ""


def test_read_snippet_clamps_at_file_boundaries(tmp_path):
    f = tmp_path / "mod.py"
    f.write_text("only_line", encoding="utf-8")

    snippet = _read_snippet(str(f), 1, context=4)

    assert snippet == "only_line"


# ---------------------------------------------------------------------------
# build_chat_context
# ---------------------------------------------------------------------------

def test_build_chat_context_returns_query_and_results(tmp_path):
    (tmp_path / "cache.py").write_text(
        "def evict_lru():\n    \"\"\"Evict the least recently used entry.\"\"\"\n    return True\n",
        encoding="utf-8",
    )
    from src.repo_map import build_repo_map

    repo_map = build_repo_map(tmp_path)
    output = build_chat_context(repo_map, "evict lru cache", tmp_path)

    assert output["query"] == "evict lru cache"
    assert output["results"]
    first = output["results"][0]
    assert set(first) == {"file", "line", "snippet", "score"}
    assert "evict_lru" in first["line"]
    assert "evict_lru" in first["snippet"]


def test_build_chat_context_caps_at_max_snippets(tmp_path):
    body = "\n".join(f"def fn_{i}():\n    return {i}\n" for i in range(10))
    (tmp_path / "mod.py").write_text(body, encoding="utf-8")
    from src.repo_map import build_repo_map

    repo_map = build_repo_map(tmp_path)
    output = build_chat_context(repo_map, "fn return", tmp_path, max_snippets=2)

    assert len(output["results"]) <= 2


def test_build_chat_context_no_match_returns_empty_results(tmp_path):
    (tmp_path / "mod.py").write_text("def foo():\n    pass\n", encoding="utf-8")
    from src.repo_map import build_repo_map

    repo_map = build_repo_map(tmp_path)
    output = build_chat_context(repo_map, "zzznonexistentquery", tmp_path)

    assert output["results"] == []


def test_build_chat_context_handles_relative_root(tmp_path, monkeypatch):
    (tmp_path / "cache.py").write_text("def evict_lru():\n    return True\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    from src.repo_map import build_repo_map

    repo_map = build_repo_map(Path("."))
    output = build_chat_context(repo_map, "evict lru", Path("."))

    assert output["results"]
    assert output["results"][0]["snippet"]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def test_cli_json_output_schema(monkeypatch, capsys, tmp_path):
    (tmp_path / "mod.py").write_text("def evict_lru():\n    return True\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["chat_context", "evict", str(tmp_path), "--json"])
    from src.chat_context import main

    main()
    out = json.loads(capsys.readouterr().out)
    assert out["query"] == "evict"
    assert "results" in out
    assert out["results"]
    assert set(out["results"][0]) == {"file", "line", "snippet", "score"}


def test_cli_json_no_query_returns_empty_results(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(sys, "argv", ["chat_context", "", str(tmp_path), "--json"])
    from src.chat_context import main

    main()
    out = json.loads(capsys.readouterr().out)
    assert out["results"] == []


def test_cli_max_snippets_flag(monkeypatch, capsys, tmp_path):
    body = "\n".join(f"def fn_{i}():\n    return {i}\n" for i in range(10))
    (tmp_path / "mod.py").write_text(body, encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["chat_context", "fn return", str(tmp_path), "--json", "--max-snippets", "1"])
    from src.chat_context import main

    main()
    out = json.loads(capsys.readouterr().out)
    assert len(out["results"]) <= 1


def test_cli_non_json_output_is_human_readable(monkeypatch, capsys, tmp_path):
    (tmp_path / "mod.py").write_text("def evict_lru():\n    return True\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["chat_context", "evict", str(tmp_path)])
    from src.chat_context import main

    main()
    out = capsys.readouterr().out
    assert "Context for: evict" in out
    assert "evict_lru" in out
