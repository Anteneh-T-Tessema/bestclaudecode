"""Tests for src/decision_log.py — per-implement-cycle audit log."""
import re

from src.decision_log import _slugify, _timestamp, list_decisions, log_decision


def test_slugify_basic():
    assert _slugify("Add caching to context.py") == "add-caching-to-contextpy"


def test_slugify_strips_special_chars():
    assert _slugify("fix: auth/login bug!") == "fix-authlogin-bug"


def test_slugify_truncates_at_max_len():
    long = "a" * 100
    assert len(_slugify(long, max_len=40)) <= 40


def test_slugify_collapses_multiple_hyphens():
    result = _slugify("foo   bar")
    assert "--" not in result


def test_timestamp_format():
    ts = _timestamp()
    assert re.match(r"\d{4}-\d{2}-\d{2}_\d{6}", ts), f"unexpected format: {ts}"


def test_log_decision_creates_file(tmp_path):
    path = log_decision(
        "refactor repo map",
        verdict="LGTM",
        retries=0,
        outcome="Extracted _outline_file into its own helper.",
        docs_dir=tmp_path,
    )
    assert path.exists()
    assert path.suffix == ".md"


def test_log_decision_file_contains_task(tmp_path):
    path = log_decision(
        "add semantic search",
        verdict="Blocking: 1 issue fixed",
        retries=1,
        outcome="TF-IDF index implemented and tests pass.",
        docs_dir=tmp_path,
    )
    content = path.read_text()
    assert "add semantic search" in content
    assert "Blocking: 1 issue fixed" in content
    assert "Retries**: 1" in content


def test_log_decision_with_findings(tmp_path):
    path = log_decision(
        "update auth flow",
        verdict="Should-fix: 2",
        retries=2,
        outcome="Auth flow updated; findings addressed.",
        findings=["Missing docstring on login()", "Unused import in auth.py"],
        docs_dir=tmp_path,
    )
    content = path.read_text()
    assert "Missing docstring" in content
    assert "Unused import" in content


def test_log_decision_default_agent(tmp_path):
    path = log_decision(
        "simple task",
        verdict="LGTM",
        retries=0,
        outcome="Done.",
        docs_dir=tmp_path,
    )
    assert "coding-agent" in path.read_text()


def test_log_decision_custom_agent(tmp_path):
    path = log_decision(
        "simple task",
        agent="code-reviewer",
        verdict="LGTM",
        retries=0,
        outcome="Reviewed.",
        docs_dir=tmp_path,
    )
    assert "code-reviewer" in path.read_text()


def test_list_decisions_sorted_newest_first(tmp_path):
    import time
    for task in ("first", "second", "third"):
        log_decision(task, verdict="LGTM", retries=0, outcome="done", docs_dir=tmp_path)
        time.sleep(0.02)
    entries = list_decisions(tmp_path)
    assert len(entries) == 3
    names = [p.stem for p in entries]
    # Newest first means "third" slug appears in the first entry's name.
    assert "third" in names[0]


def test_list_decisions_empty_for_missing_dir(tmp_path):
    assert list_decisions(tmp_path / "nonexistent") == []


def test_log_decision_creates_docs_dir_if_missing(tmp_path):
    nested = tmp_path / "deep" / "nested"
    path = log_decision(
        "test nested dir creation",
        verdict="LGTM",
        retries=0,
        outcome="Created nested directory.",
        docs_dir=nested,
    )
    assert nested.exists()
    assert path.exists()
