"""Tests for src/agent_memory.py."""
import json
from pathlib import Path

from src.agent_memory import (
    MemoryEntry,
    MemoryStore,
    auto_record_from_decision,
    _slugify,
    _tokenise,
)


# --- helpers ----------------------------------------------------------------

def test_slugify_basic():
    assert _slugify("src/auth/module.py") == "src-auth-module.py"


def test_slugify_max_len():
    assert len(_slugify("x" * 100, max_len=10)) <= 10


def test_slugify_colons_preserved():
    assert "task:" in _slugify("task:add-user")


def test_tokenise_removes_stopwords():
    tokens = _tokenise("the auth module is broken")
    assert "the" not in tokens
    assert "is" not in tokens
    assert "auth" in tokens


def test_tokenise_lowercases():
    assert _tokenise("Auth") == ["auth"]


# --- MemoryEntry ------------------------------------------------------------

def test_memory_entry_roundtrip():
    e = MemoryEntry(
        key="auth",
        content="Always run migrations",
        tags=["db", "migration"],
        created_at="2026-06-19T00:00:00Z",
        updated_at="2026-06-19T01:00:00Z",
        source_task="add field",
    )
    d = e.to_dict()
    e2 = MemoryEntry.from_dict(d)
    assert e2.key == e.key
    assert e2.content == e.content
    assert e2.tags == e.tags


def test_memory_entry_repr():
    e = MemoryEntry("k", "c", [], "", "", "")
    assert "k" in repr(e)


# --- MemoryStore.write ------------------------------------------------------

def test_write_creates_file(tmp_path):
    store = MemoryStore(tmp_path / "mem")
    path = store.write("auth-module", "run migrations after adding a field")
    assert path.exists()


def test_write_creates_dir_if_missing(tmp_path):
    store = MemoryStore(tmp_path / "deep" / "mem")
    store.write("k", "v")
    assert (tmp_path / "deep" / "mem").exists()


def test_write_content_is_valid_json(tmp_path):
    store = MemoryStore(tmp_path)
    path = store.write("k", "some content", tags=["foo"])
    data = json.loads(path.read_text())
    assert data["content"] == "some content"
    assert data["tags"] == ["foo"]


def test_write_update_preserves_created_at(tmp_path):
    store = MemoryStore(tmp_path)
    store.write("k", "first")
    entry1 = store.get("k")
    store.write("k", "second")
    entry2 = store.get("k")
    assert entry1.created_at == entry2.created_at
    assert entry2.content == "second"


def test_write_update_changes_updated_at(tmp_path):
    store = MemoryStore(tmp_path)
    store.write("k", "first")
    e1 = store.get("k")
    store.write("k", "second")
    e2 = store.get("k")
    assert e2.updated_at >= e1.updated_at


# --- MemoryStore.get / list_all / delete ------------------------------------

def test_get_returns_none_for_missing(tmp_path):
    store = MemoryStore(tmp_path)
    assert store.get("nonexistent") is None


def test_list_all_empty_dir(tmp_path):
    store = MemoryStore(tmp_path / "empty")
    assert store.list_all() == []


def test_list_all_returns_entries(tmp_path):
    store = MemoryStore(tmp_path)
    store.write("a", "alpha")
    store.write("b", "beta")
    entries = store.list_all()
    assert len(entries) == 2


def test_list_all_newest_first(tmp_path):
    store = MemoryStore(tmp_path)
    from unittest.mock import patch
    with patch("src.agent_memory._utcnow", side_effect=["2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]):
        store.write("a", "old")
    with patch("src.agent_memory._utcnow", side_effect=["2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z"]):
        store.write("b", "new")
    entries = store.list_all()
    assert entries[0].key == "b"


def test_delete_removes_file(tmp_path):
    store = MemoryStore(tmp_path)
    store.write("k", "v")
    assert store.delete("k")
    assert store.get("k") is None


def test_delete_returns_false_for_missing(tmp_path):
    store = MemoryStore(tmp_path)
    assert not store.delete("nonexistent")


# --- MemoryStore.query (BM25) -----------------------------------------------

def test_query_returns_relevant_entry(tmp_path):
    store = MemoryStore(tmp_path)
    store.write("auth", "Adding a field to User requires a migration", tags=["db"])
    store.write("cache", "LRU eviction kicks in when memory exceeds limit", tags=["perf"])
    results = store.query("database migration user field")
    assert results[0].key == "auth"


def test_query_empty_store(tmp_path):
    store = MemoryStore(tmp_path / "empty")
    assert store.query("anything") == []


def test_query_no_stems_returns_all(tmp_path):
    store = MemoryStore(tmp_path)
    store.write("a", "alpha")
    store.write("b", "beta")
    results = store.query("the an")  # stopwords only
    assert len(results) == 2


def test_query_top_k_cap(tmp_path):
    store = MemoryStore(tmp_path)
    for i in range(10):
        store.write(f"entry-{i}", f"context injection module {i}")
    results = store.query("context injection", top_k=3)
    assert len(results) <= 3


# --- format_memory_block ----------------------------------------------------

def test_format_memory_block_empty():
    store = MemoryStore(Path("."))
    assert store.format_memory_block([]) == ""


def test_format_memory_block_contains_key(tmp_path):
    store = MemoryStore(tmp_path)
    e = MemoryEntry("auth-module", "Always run migrations", ["db"], "", "", "")
    block = store.format_memory_block([e])
    assert "auth-module" in block
    assert "Always run migrations" in block


def test_format_memory_block_header(tmp_path):
    store = MemoryStore(tmp_path)
    e = MemoryEntry("k", "v", [], "", "", "")
    block = store.format_memory_block([e])
    assert "## Agent memory" in block


# --- auto_record_from_decision ----------------------------------------------

def test_auto_record_writes_summary(tmp_path):
    paths = auto_record_from_decision(
        "add email field", "Added field and migration", memory_dir=tmp_path
    )
    assert any(p.exists() for p in paths)


def test_auto_record_extracts_file_from_finding(tmp_path):
    auto_record_from_decision(
        "add field",
        "done",
        findings=["src/auth/models.py:45 — missing null=True"],
        memory_dir=tmp_path,
    )
    store = MemoryStore(tmp_path)
    entries = store.list_all()
    keys = [e.key for e in entries]
    assert any("src-auth-models-py" in k for k in keys)


def test_auto_record_no_findings(tmp_path):
    paths = auto_record_from_decision("task", "outcome", findings=None, memory_dir=tmp_path)
    assert len(paths) == 1  # just the summary
