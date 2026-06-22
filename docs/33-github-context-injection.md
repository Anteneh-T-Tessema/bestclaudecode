# Step 33 — GitHub context injection (closes Devin GitHub gap)

## What was built

**`src/github_context.py`** — GitHub issue and PR context injection via the
`gh` CLI, matching Devin's native GitHub integration.

Devin reads GitHub issues and PRs before starting work — it arrives knowing
the acceptance criteria, linked PRs, and reviewer comments. This module
provides identical capability using `gh`, which is already present in most
developer environments.

Key API:
- `GithubComment(author, body)` / `GithubIssue(number, title, body, labels, url, comments, kind)`
- `fetch_issue(number, repo, runner)` — fetches via `gh issue view --json`
- `fetch_pr(number, repo, runner)` — same shape for PRs
- `format_issue_block(issue)` — labelled Markdown block (body ≤40 lines,
  comments ≤5 × 8 lines, truncation noted)
- `parse_github_flags(args)` → `(issue_num, pr_num, remaining_args)` — extracts
  `--issue N` and `--pr N` from command args

The `runner` parameter is injectable — tests pass a fake runner that returns
JSON without hitting GitHub.

**`src/tests/test_github_context.py`** — 25 tests covering JSON parsing, all
formatting edge cases (null body, many comments, truncation), flag parsing
including non-numeric values, and injected runner verification.

## Why

Devin's GitHub integration is always-on and opaque. This implementation is
explicit and auditable — the formatted block is visible in the agent's prompt
header and can be logged or diffed.

## Test count after this step: 228
