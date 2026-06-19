# Step 15: Background agents (/bg-review) and package_root fix

Two changes. The primary new capability is **background agents** — the first
command in this repo that spawns a subagent with `run_in_background: true` and
returns before it finishes. The warmup is a correctness fix to `repo_map.py`'s
import resolver that was documented as a known gap in Step 13.

---

## Warmup: `package_root` parameter in `build_repo_map`

### The bug

`_module_to_candidates` resolved absolute imports (`import foo`) by anchoring
to `root` — the directory passed to `build_repo_map`. This works when `root`
is also the Python package root (e.g., `build_repo_map(Path("src"))`). It
silently misses deps when `root` is a project root containing a subdirectory
with the actual sources:

```
# Scan root = project/  (repo root)
# Source files at project/src/utils.py, project/src/a.py
# a.py does: import utils
#
# Without package_root:
#   _module_to_candidates("utils", ..., root=project/)
#   → candidate: project/utils.py   ✗ (does not exist)
#   → dep silently missed
#
# With package_root=project/src:
#   _module_to_candidates("utils", ..., package_root=project/src)
#   → candidate: project/src/utils.py  ✓
```

### The fix

`_module_to_candidates` now takes an explicit `package_root` parameter
(separate from `root`). `_collect_imports` and `build_repo_map` thread it
through. It defaults to `root` when not supplied, so all existing call sites
are unaffected — backward-compatible change.

### What was tested

1 new test (`test_deps_package_root_resolves_bare_module_names`) verifies the
exact scenario above: scanning from `tmp_path` with sources under `tmp_path/src`,
`import utils` in `a.py` is missed without `package_root=src` and found with it.
The assertion checks the imports line of `a.py`'s block specifically — not the
full output — because `utils.py` would appear elsewhere in the output as its own
section header regardless.

---

## Feature: `/bg-review` command

### What it is

`/bg-review [path]` spawns a `code-reviewer` Agent with
`run_in_background: True` and returns immediately. The harness automatically
re-invokes the session when the reviewer finishes, at which point the findings
are reported in the same severity-sorted format as `/review`.

### Why this is different from every other command in this repo

Every other orchestration command here blocks:

| Command | Blocks? | Returns when |
|---|---|---|
| `/review` | yes | reviewer finishes |
| `/parallel-review` | yes | all reviewers finish |
| `/implement` | yes | coding-agent + reviewer finish |
| `/blueprint` | yes | spec chain finishes |
| `/bg-review` | **no** | reviewer is *started* |

With `/bg-review`, the user can continue interacting with Claude, run other
commands, or start other background reviews while the review runs. Results
arrive as a notification.

### The `run_in_background` parameter

```python
Agent(
    description="Background code review",
    subagent_type="code-reviewer",
    prompt="...",
    run_in_background=True,   # ← this is the only new thing
)
```

`run_in_background=True` is not a shell `&` — the agent runs inside the Claude
Code process. The difference is that the parent session's turn ends before the
agent finishes. When the agent completes, the harness fires the session again
automatically.

### What the command does

1. Derives the diff scope the same way `/review` does (unstaged → staged →
   merge-base diff → untracked file warning).
2. Spawns one `code-reviewer` instance with `run_in_background: True`.
3. Returns immediately with:
   - Confirmation that the review started.
   - The scope being reviewed (path or diff summary).
   - A note that Claude will notify when done.
4. On harness re-invocation, reports the full findings verbatim.

### When to use /bg-review vs /review vs /parallel-review

- **`/review`**: blocking, results immediately, small diffs.
- **`/parallel-review <p1> <p2>`**: blocking, multiple files reviewed
  simultaneously in a single turn.
- **`/bg-review`**: non-blocking, one reviewer, results arrive later. Use when
  the diff is large and you want to keep working; or as a building block for a
  hypothetical future command that fires several background reviews and
  aggregates when all are done.

### Honest limitations

1. If the session ends before the background agent completes, findings are lost
   — the harness only notifies the active session.
2. The re-invocation timing is controlled by the harness, not this command —
   no polling mechanism is needed or possible.
3. `run_in_background: True` is not demonstrated with a live run here (unlike
   Step 13's live `/parallel-review` exercise) because a background agent that
   completes mid-documentation would produce findings for this step's own
   in-progress diff, which would be circular. The command's design is
   documented and the parameter is real; a live exercise would be the first
   thing to run once this step is committed.

---

## Honest gaps remaining after Step 15

1. `package_root` is not exposed via the CLI (`--package-root` flag). Anyone
   calling `python -m src.repo_map --deps` from the project root still hits the
   old behavior. Low-priority since the public API (`build_repo_map`) is fixed.
2. The `root`-assumption in `_module_to_candidates` applies to `import foo` and
   `from foo import bar`, but *not* to `from . import name` (the relative-import
   branch uses `file_path.parent`, which is always correct — no `package_root`
   needed there).
3. No live evidence of the harness re-invocation completing — the background
   agent pattern is design-proven but not yet observed end-to-end in this repo.
   That evidence would come from running `/bg-review` against a real diff after
   this step is committed.
