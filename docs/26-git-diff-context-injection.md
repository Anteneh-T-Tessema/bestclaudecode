# Step 26: Git diff context injection

## What was built

**`src/diff_context.py`** — two public functions:

- `get_diff(ref="HEAD", *, repo_root, cached)` — runs `git diff <ref>` (or
  `git diff --cached` for staged-only) via `subprocess.run` with a 10-second
  timeout. Returns an empty string if git is unavailable, the directory is not
  a repo, or there are no changes. Never raises.

- `format_context_with_diff(root, task, *, ref, cached, ...)` — wraps
  `format_context()` and inserts a `## Recent changes (git diff <ref>)` fenced
  diff block between the orientation and the task section. The diff is capped
  at `max_diff_lines` (default 150) with a truncation note. All
  `format_context()` parameters (`include_deps`, `package_root`,
  `max_map_lines`, `task_filter`, `include_ts`) are forwarded.

Internal: `_format_diff_block(diff, max_lines)` handles the fenced formatting
and returns an empty string for empty/whitespace-only diffs so callers don't
need to guard.

**`src/tests/test_diff_context.py`** — 10 tests covering: empty/whitespace
diff → empty block; fenced block format; truncation at `max_lines`; git not
found → empty string; timeout → empty string; ref passed correctly; `--cached`
flag; diff block present when diff non-empty; diff block absent when no diff;
task always last in output.

## Why

The biggest single gap between this system and Cursor/Devin was that the agent
orientation told it *what the codebase looks like* but not *what has changed
since the last commit*. An agent implementing "add a route" needs to know if
a route was already partially added in a staged change — without diff context,
it re-implements or conflicts.

The placement (orientation → diff → task) mirrors how a human reviewer reads
code: understand the layout, review what changed, then address the request.

## What was verified

- 10 new tests pass, all using `unittest.mock.patch` to isolate `subprocess`
- `format_context_with_diff` on a real tmp_path repo emits the correct sections
  in the correct order
- Full suite: 118 tests, 0 failures
- `ruff check src` clean

## Deliberately left undone

- The diff is not cached (diffs change on every file write, so caching would
  require invalidation on every edit — not worth it).
- `format_context_with_diff` is not yet wired into the `/context-implement`
  slash command — that requires adding a `--diff` flag to the command file.
  The Python API is complete; the CLI integration is a future step.
