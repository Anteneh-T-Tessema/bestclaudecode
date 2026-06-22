"""Tests for src/github_context.py."""
import json

from src.github_context import (
    GithubComment,
    GithubIssue,
    format_issue_block,
    parse_github_flags,
    fetch_issue,
    fetch_pr,
    _parse_issue_json,
)


# --- _parse_issue_json ------------------------------------------------------

def _make_raw(
    number=42,
    title="Add BM25",
    body="We need BM25",
    labels=None,
    url="https://github.com/org/repo/issues/42",
    comments=None,
) -> str:
    return json.dumps({
        "number": number,
        "title": title,
        "body": body,
        "labels": [{"name": lb} for lb in (labels or [])],
        "url": url,
        "comments": comments or [],
    })


def test_parse_issue_json_basic():
    issue = _parse_issue_json(_make_raw(), "issue")
    assert issue.number == 42
    assert issue.title == "Add BM25"
    assert issue.kind == "issue"


def test_parse_issue_json_labels():
    raw = _make_raw(labels=["enhancement", "search"])
    issue = _parse_issue_json(raw, "issue")
    assert issue.labels == ["enhancement", "search"]


def test_parse_issue_json_comments():
    comments = [{"author": {"login": "alice"}, "body": "LGTM"}]
    raw = _make_raw(comments=comments)
    issue = _parse_issue_json(raw, "issue")
    assert len(issue.comments) == 1
    assert issue.comments[0].author == "alice"
    assert issue.comments[0].body == "LGTM"


def test_parse_issue_json_null_body():
    raw = json.dumps({"number": 1, "title": "T", "body": None, "labels": [], "url": "", "comments": []})
    issue = _parse_issue_json(raw, "issue")
    assert issue.body == ""


def test_parse_pr_kind():
    issue = _parse_issue_json(_make_raw(), "pr")
    assert issue.kind == "pr"


# --- format_issue_block -----------------------------------------------------

def _make_issue(**kw) -> GithubIssue:
    defaults = dict(number=7, title="Fix bug", body="Something broke", labels=[], url="http://x", comments=[], kind="issue")
    defaults.update(kw)
    return GithubIssue(**defaults)


def test_format_header_issue():
    block = format_issue_block(_make_issue())
    assert "## GitHub Issue #7: Fix bug" in block


def test_format_header_pr():
    block = format_issue_block(_make_issue(kind="pr"))
    assert "## GitHub Pull Request #7" in block


def test_format_labels_present():
    block = format_issue_block(_make_issue(labels=["bug", "urgent"]))
    assert "bug" in block and "urgent" in block


def test_format_no_labels_line_absent():
    block = format_issue_block(_make_issue(labels=[]))
    assert "Labels:" not in block


def test_format_url_present():
    block = format_issue_block(_make_issue(url="https://github.com/org/repo/issues/7"))
    assert "https://github.com/org/repo/issues/7" in block


def test_format_body_present():
    block = format_issue_block(_make_issue(body="We need BM25 ranking"))
    assert "We need BM25 ranking" in block


def test_format_body_truncated():
    long_body = "\n".join(f"line {i}" for i in range(60))
    block = format_issue_block(_make_issue(body=long_body))
    assert "truncated" in block


def test_format_comments_present():
    comments = [GithubComment(author="alice", body="LGTM")]
    block = format_issue_block(_make_issue(comments=comments))
    assert "@alice" in block
    assert "LGTM" in block


def test_format_comment_body_truncated():
    long_comment = "\n".join(f"line {i}" for i in range(20))
    comments = [GithubComment(author="bob", body=long_comment)]
    block = format_issue_block(_make_issue(comments=comments))
    assert "truncated" in block


def test_format_max_five_comments():
    comments = [GithubComment(author=f"u{i}", body=f"comment {i}") for i in range(10)]
    block = format_issue_block(_make_issue(comments=comments))
    assert block.count("@u") <= 5


def test_format_no_comments_block_absent():
    block = format_issue_block(_make_issue(comments=[]))
    assert "**Comments**" not in block


# --- parse_github_flags -----------------------------------------------------

def test_parse_issue_flag():
    issue, pr, rest = parse_github_flags(["--issue", "42", "add search"])
    assert issue == 42
    assert pr is None
    assert rest == ["add search"]


def test_parse_pr_flag():
    issue, pr, rest = parse_github_flags(["--pr", "7", "fix thing"])
    assert issue is None
    assert pr == 7
    assert rest == ["fix thing"]


def test_parse_both_flags():
    issue, pr, rest = parse_github_flags(["--issue", "1", "--pr", "2", "task"])
    assert issue == 1
    assert pr == 2
    assert rest == ["task"]


def test_parse_no_flags():
    issue, pr, rest = parse_github_flags(["--deps", "task text"])
    assert issue is None
    assert pr is None
    assert rest == ["--deps", "task text"]


def test_parse_empty_args():
    issue, pr, rest = parse_github_flags([])
    assert issue is None
    assert pr is None
    assert rest == []


def test_parse_non_numeric_issue_passes_through():
    issue, pr, rest = parse_github_flags(["--issue", "abc"])
    assert issue is None
    assert "--issue" in rest


# --- fetch_issue / fetch_pr (injected runner) --------------------------------

def test_fetch_issue_uses_runner():
    called = []

    def fake_runner(cmd):
        called.append(cmd)
        return _make_raw(number=5, title="Test issue")

    issue = fetch_issue(5, runner=fake_runner)
    assert issue.number == 5
    assert "issue" in called[0]
    assert "5" in called[0]


def test_fetch_pr_uses_runner():
    def fake_runner(cmd):
        return _make_raw(number=3, title="Test PR")

    pr = fetch_pr(3, runner=fake_runner)
    assert pr.number == 3
    assert pr.kind == "pr"


def test_fetch_issue_with_repo_flag():
    captured = []

    def fake_runner(cmd):
        captured.extend(cmd)
        return _make_raw()

    fetch_issue(1, repo="org/repo", runner=fake_runner)
    assert "--repo" in captured
    assert "org/repo" in captured
