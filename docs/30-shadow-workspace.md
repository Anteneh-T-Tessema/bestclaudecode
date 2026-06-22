# Step 30 — Shadow workspace (closes Cursor diff preview gap)

## What was built

**`src/shadow_workspace.py`** — git worktree-based shadow workspace for
previewing agent changes before applying them to the main working tree.

Cursor's "shadow workspace" lets the agent implement in an isolated copy of the
repo, shows the developer the diff, and only promotes changes after approval.
This implementation uses `git worktree add`, which is native to git — no extra
tooling, and the shadow branch is real git history.

Key API:
- `ShadowWorkspace.create(base_ref, prefix)` — creates a worktree on a new branch
- `.diff()` — uncommitted changes inside the shadow
- `.diff_vs_base()` — all changes (committed + uncommitted) vs the base ref
- `.promote()` — cherry-picks the shadow's top commit to the main tree
- `.discard()` — removes the worktree and deletes the branch
- Context manager: auto-discards on exit unless `.promote()` was called
- `format_shadow_header(ws)` — Markdown context block for prompt injection

**`src/tests/test_shadow_workspace.py`** — 15 tests (14 unit + 1 integration
marked `@pytest.mark.integration`) covering all operations via mocking plus a
real git worktree integration test that skips gracefully if git is unavailable.

## Why

Without a shadow workspace, every agent implement cycle writes directly to the
main working tree. If the reviewer finds Blocking issues the developer sees a
partially-modified tree. The shadow workspace lets the agent work in isolation;
the developer sees the full diff before anything lands.

## Test count after this step: 158
