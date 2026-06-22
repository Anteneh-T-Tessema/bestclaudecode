"""GitHub issue and PR context injection for agent prompts.

Devin natively reads GitHub issues and PRs before starting work — it arrives
knowing the acceptance criteria, linked PRs, and reviewer comments without the
developer having to paste them. This module provides the same capability via
the ``gh`` CLI, which is already present in most developer environments.

The formatted output is a fenced context block injected into the orientation
prompt alongside the repo map and optional diff:

    ## GitHub Issue #42: Add BM25 search

    Labels: enhancement, search
    URL: https://github.com/org/repo/issues/42

    **Description**
    We need BM25 to replace TF-IDF for better ranking ...

    **Comments** (2)
    @alice: Consider using k1=1.5 and b=0.75 ...
    @bob: Also see the Robertson 1994 paper ...

Flag parsing
------------
``parse_github_flags(args)`` extracts ``--issue N`` and ``--pr N`` from the
args list (same pattern as diff_context's ref parsing). Both flags are
optional; if absent no GitHub context is injected.

CLI
---
    python -m src.github_context --issue 42
    python -m src.github_context --pr 7
"""
from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class GithubComment:
    """One comment on an issue or PR."""

    author: str
    body: str


@dataclass
class GithubIssue:
    """Parsed GitHub issue or pull request."""

    number: int
    title: str
    body: str
    labels: list[str]
    url: str
    comments: list[GithubComment] = field(default_factory=list)
    kind: str = "issue"   # "issue" | "pr"


# ---------------------------------------------------------------------------
# Fetchers (use gh CLI)
# ---------------------------------------------------------------------------

def fetch_issue(
    number: int,
    *,
    repo: str = "",
    runner: object = None,
) -> GithubIssue:
    """Fetch a GitHub issue via the ``gh`` CLI and return a GithubIssue.

    Args:
        number: issue number.
        repo: optional ``owner/repo`` string; omit to use the current repo.
        runner: injectable callable for testing. Signature:
            ``runner(cmd: list[str]) -> str``. Defaults to real ``gh`` invocation.
    """
    run = runner or _gh_run
    repo_flag = ["--repo", repo] if repo else []
    raw = run(
        ["gh", "issue", "view", str(number), "--json",
         "number,title,body,labels,url,comments", *repo_flag]
    )
    return _parse_issue_json(raw, kind="issue")


def fetch_pr(
    number: int,
    *,
    repo: str = "",
    runner: object = None,
) -> GithubIssue:
    """Fetch a GitHub PR via the ``gh`` CLI and return a GithubIssue.

    Uses the same data shape as fetch_issue so callers can treat issues and
    PRs uniformly.
    """
    run = runner or _gh_run
    repo_flag = ["--repo", repo] if repo else []
    raw = run(
        ["gh", "pr", "view", str(number), "--json",
         "number,title,body,labels,url,comments", *repo_flag]
    )
    return _parse_issue_json(raw, kind="pr")


def _gh_run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"gh command failed: {' '.join(cmd)}\n{result.stderr.strip()}"
        )
    return result.stdout


def _parse_issue_json(raw: str, kind: str) -> GithubIssue:
    data = json.loads(raw)
    labels = [lb["name"] if isinstance(lb, dict) else str(lb) for lb in data.get("labels", [])]
    raw_comments = data.get("comments", [])
    comments = [
        GithubComment(
            author=c.get("author", {}).get("login", "unknown") if isinstance(c, dict) else "unknown",
            body=c.get("body", "") if isinstance(c, dict) else str(c),
        )
        for c in raw_comments
    ]
    return GithubIssue(
        number=data["number"],
        title=data.get("title", ""),
        body=data.get("body", "") or "",
        labels=labels,
        url=data.get("url", ""),
        comments=comments,
        kind=kind,
    )


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

_MAX_BODY_LINES = 40
_MAX_COMMENT_LINES = 8
_MAX_COMMENTS = 5


def format_issue_block(issue: GithubIssue) -> str:
    """Return a labelled Markdown block suitable for context injection.

    Long bodies and comments are truncated so the block doesn't dominate the
    context window on verbose issues.
    """
    kind_label = "Pull Request" if issue.kind == "pr" else "Issue"
    label_str = f"\nLabels: {', '.join(issue.labels)}" if issue.labels else ""
    header = (
        f"## GitHub {kind_label} #{issue.number}: {issue.title}\n"
        f"{label_str}\n"
        f"URL: {issue.url}\n"
    )

    body_lines = issue.body.splitlines()[:_MAX_BODY_LINES]
    body_trimmed = "\n".join(body_lines)
    if len(issue.body.splitlines()) > _MAX_BODY_LINES:
        body_trimmed += "\n… (truncated)"

    body_block = f"\n**Description**\n{body_trimmed}\n" if body_trimmed.strip() else ""

    comment_parts: list[str] = []
    for c in issue.comments[:_MAX_COMMENTS]:
        c_lines = c.body.splitlines()[:_MAX_COMMENT_LINES]
        c_body = "\n".join(c_lines)
        if len(c.body.splitlines()) > _MAX_COMMENT_LINES:
            c_body += "\n… (truncated)"
        comment_parts.append(f"@{c.author}: {c_body}")

    comment_block = ""
    if comment_parts:
        n = len(issue.comments)
        comment_block = f"\n**Comments** ({n})\n" + "\n\n".join(comment_parts) + "\n"

    return header + body_block + comment_block


# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------

def parse_github_flags(
    args: list[str],
) -> tuple[int | None, int | None, list[str]]:
    """Extract --issue N and --pr N from args.

    Returns (issue_number, pr_number, remaining_args).
    Both numbers are None if the corresponding flag is absent.
    """
    issue_num: int | None = None
    pr_num: int | None = None
    remaining: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == "--issue" and i + 1 < len(args):
            try:
                issue_num = int(args[i + 1])
                i += 2
                continue
            except ValueError:
                pass
        if args[i] == "--pr" and i + 1 < len(args):
            try:
                pr_num = int(args[i + 1])
                i += 2
                continue
            except ValueError:
                pass
        remaining.append(args[i])
        i += 1
    return issue_num, pr_num, remaining


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _issue_to_dict(issue: GithubIssue) -> dict:
    """Serialize a GithubIssue to a JSON-compatible dict."""
    return {
        "number": issue.number,
        "title": issue.title,
        "body": issue.body,
        "labels": issue.labels,
        "url": issue.url,
        "kind": issue.kind,
        "comments": [{"author": c.author, "body": c.body} for c in issue.comments],
    }


def main() -> None:
    """CLI: python -m src.github_context --issue N | --pr N [--repo owner/repo] [--json]"""
    args = sys.argv[1:]
    repo = ""
    if "--repo" in args:
        idx = args.index("--repo")
        repo = args[idx + 1] if idx + 1 < len(args) else ""
        args = [a for a in args if a != "--repo" and a != repo]

    as_json = "--json" in args
    if as_json:
        args = [a for a in args if a != "--json"]

    issue_num, pr_num, _ = parse_github_flags(args)
    if issue_num is None and pr_num is None:
        print("Usage: python -m src.github_context --issue N | --pr N", file=sys.stderr)
        sys.exit(1)

    try:
        if issue_num is not None:
            item = fetch_issue(issue_num, repo=repo)
        else:
            item = fetch_pr(pr_num, repo=repo)  # type: ignore[arg-type]
        if as_json:
            print(json.dumps(_issue_to_dict(item)))
        else:
            print(format_issue_block(item))
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
