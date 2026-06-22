"""Tests for src/decision_analytics.py."""
from pathlib import Path

from src.decision_analytics import (
    ParsedDecision,
    parse_decision_file,
    load_decisions,
    compute_stats,
    format_analytics_report,
)


# --- fixtures ---------------------------------------------------------------

DECISION_LGTM = """\
# Decision: Add BM25 index

**Agent**: coding-agent
**Retries**: 0
**Verdict**: LGTM
**Outcome**: Added BM25Index class with persistence
"""

DECISION_BLOCKING = """\
# Decision: Fix auth bug

**Agent**: coding-agent
**Retries**: 1
**Verdict**: Blocking
**Outcome**: Fixed null check in login handler

## Reviewer findings

- src/auth/models.py:42 — missing null check
- src/auth/views.py:10 — bare except
"""


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


# --- parse_decision_file ----------------------------------------------------

def test_parse_task(tmp_path):
    p = _write(tmp_path, "2026-06-19_120000_bm25.md", DECISION_LGTM)
    d = parse_decision_file(p)
    assert d is not None
    assert d.task == "Add BM25 index"


def test_parse_agent(tmp_path):
    p = _write(tmp_path, "d.md", DECISION_LGTM)
    d = parse_decision_file(p)
    assert d.agent == "coding-agent"


def test_parse_retries_zero(tmp_path):
    p = _write(tmp_path, "d.md", DECISION_LGTM)
    d = parse_decision_file(p)
    assert d.retries == 0


def test_parse_retries_nonzero(tmp_path):
    p = _write(tmp_path, "d.md", DECISION_BLOCKING)
    d = parse_decision_file(p)
    assert d.retries == 1


def test_parse_verdict(tmp_path):
    p = _write(tmp_path, "d.md", DECISION_LGTM)
    d = parse_decision_file(p)
    assert d.verdict == "LGTM"


def test_parse_outcome(tmp_path):
    p = _write(tmp_path, "d.md", DECISION_LGTM)
    d = parse_decision_file(p)
    assert "BM25" in d.outcome


def test_parse_findings(tmp_path):
    p = _write(tmp_path, "d.md", DECISION_BLOCKING)
    d = parse_decision_file(p)
    assert len(d.findings) == 2
    assert any("null check" in f for f in d.findings)


def test_parse_no_findings(tmp_path):
    p = _write(tmp_path, "d.md", DECISION_LGTM)
    d = parse_decision_file(p)
    assert d.findings == []


def test_parse_missing_file():
    assert parse_decision_file(Path("/nonexistent/file.md")) is None


# --- load_decisions ---------------------------------------------------------

def test_load_decisions_empty_dir(tmp_path):
    assert load_decisions(tmp_path / "empty") == []


def test_load_decisions_returns_all(tmp_path):
    _write(tmp_path, "2026-06-20_a.md", DECISION_LGTM)
    _write(tmp_path, "2026-06-19_b.md", DECISION_BLOCKING)
    results = load_decisions(tmp_path)
    assert len(results) == 2


def test_load_decisions_newest_first(tmp_path):
    _write(tmp_path, "2026-06-19_old.md", DECISION_LGTM)
    _write(tmp_path, "2026-06-20_new.md", DECISION_BLOCKING)
    results = load_decisions(tmp_path)
    assert results[0].filename == "2026-06-20_new.md"


# --- compute_stats ----------------------------------------------------------

def _make_decisions(*specs: tuple) -> list[ParsedDecision]:
    """specs = (verdict, retries, findings)"""
    result = []
    for i, (verdict, retries, findings) in enumerate(specs):
        result.append(ParsedDecision(
            filename=f"d{i}.md",
            task=f"task {i}",
            agent="coding-agent",
            verdict=verdict,
            retries=retries,
            outcome="done",
            findings=findings,
        ))
    return result


def test_compute_stats_empty():
    stats = compute_stats([])
    assert stats.total == 0
    assert stats.retry_rate_pct == 0.0


def test_compute_stats_total():
    decisions = _make_decisions(("LGTM", 0, []), ("Blocking", 1, []))
    assert compute_stats(decisions).total == 2


def test_compute_stats_retry_rate():
    decisions = _make_decisions(("LGTM", 0, []), ("Blocking", 1, []))
    stats = compute_stats(decisions)
    assert stats.with_retry == 1
    assert stats.retry_rate_pct == 50.0


def test_compute_stats_verdict_counts():
    decisions = _make_decisions(("LGTM", 0, []), ("LGTM", 0, []), ("Blocking", 1, []))
    stats = compute_stats(decisions)
    assert stats.verdict_counts["LGTM"] == 2
    assert stats.verdict_counts["Blocking"] == 1


def test_compute_stats_top_findings():
    finding = "src/auth/models.py:42 — missing null check"
    decisions = _make_decisions(
        ("Blocking", 1, [finding]),
        ("Blocking", 1, [finding]),
        ("LGTM", 0, []),
    )
    stats = compute_stats(decisions)
    assert stats.top_findings[0][0].startswith("src/auth")
    assert stats.top_findings[0][1] == 2


def test_compute_stats_top_files():
    decisions = _make_decisions(
        ("Blocking", 1, ["src/auth/models.py:42 — issue"]),
        ("Blocking", 1, ["src/auth/models.py:10 — another"]),
    )
    stats = compute_stats(decisions)
    assert stats.top_files[0][0] == "src/auth/models.py"
    assert stats.top_files[0][1] == 2


def test_compute_stats_agents():
    decisions = _make_decisions(("LGTM", 0, []), ("LGTM", 0, []))
    stats = compute_stats(decisions)
    assert stats.agents["coding-agent"] == 2


# --- format_analytics_report ------------------------------------------------

def test_format_report_empty():
    report = format_analytics_report(compute_stats([]))
    assert "no entries" in report


def test_format_report_header():
    decisions = _make_decisions(("LGTM", 0, []))
    report = format_analytics_report(compute_stats(decisions))
    assert "## Decision log analytics" in report


def test_format_report_total():
    decisions = _make_decisions(("LGTM", 0, []), ("Blocking", 1, []))
    report = format_analytics_report(compute_stats(decisions))
    assert "2" in report


def test_format_report_retry_rate():
    decisions = _make_decisions(("LGTM", 0, []), ("Blocking", 1, []))
    report = format_analytics_report(compute_stats(decisions))
    assert "50.0%" in report


def test_format_report_findings():
    decisions = _make_decisions(
        ("Blocking", 1, ["src/auth/models.py:42 — null check"])
    )
    report = format_analytics_report(compute_stats(decisions))
    assert "null check" in report
