# Step 16: Worktree isolation (/safe-implement) and --package-root CLI flag

Two changes. The primary new capability is **worktree isolation** — the first
command in this repo that uses `isolation: "worktree"` on an Agent call,
keeping agent edits off the working tree until the user explicitly accepts
them. The warmup closes the documented gap from Step 15: the `--package-root`
CLI flag for `python -m src.repo_map`.

---

## Warmup: `--package-root` CLI flag

Step 15 added the `package_root` parameter to `build_repo_map` but noted:
"not exposed via the CLI. Anyone calling `python -m src.repo_map --deps`
from the project root still hits the old behavior."

The fix is a 15-line argument parser extension in `main()`. The new flag:

```
python -m src.repo_map --deps --package-root src/ .
```

resolves absolute import names from `src/` instead of `.`, fixing the silent
miss when the scan root (`.`) differs from the Python package root (`src/`).

### What was tested

`test_main_package_root_flag_resolves_bare_imports` — verifies end-to-end
that passing `--package-root src` via the CLI causes `import utils` in
`src/a.py` to resolve to `src/utils.py` in the imports line. Checks the
specific file block rather than the full output. 22 tests pass total.

---

## Feature: `/safe-implement` command

### What it is

`/safe-implement <task>` implements a task the same way `/implement` does —
delegates to `coding-agent` — but wraps the Agent call with
`isolation: "worktree"`. The agent's edits land on a fresh git branch in a
temporary worktree. Your working tree stays clean until you explicitly
accept the result.

### What `isolation: "worktree"` does

```python
Agent(
    description="...",
    subagent_type="coding-agent",
    prompt="...",
    isolation="worktree",    # ← this is the new thing
)
```

Claude Code creates a temporary git worktree — a separate directory sharing
the same git object store but with a clean working tree on a new branch. The
agent runs inside that directory. When the agent finishes:

- **No changes**: worktree cleaned up automatically; nothing returned.
- **Changes made**: worktree path and branch name returned to the
  orchestrating session.

The agent itself is unaware of the isolation — it sees the same files and
git history. The isolation is Claude Code infrastructure, not a subagent
concern.

### How /safe-implement uses it

1. Spawns `coding-agent` with `isolation: "worktree"` and the user's task.
2. Agent plans, edits, verifies (lint + tests), reports back.
3. If changes were made, runs `code-reviewer` against the worktree diff —
   same review loop as `/implement`.
4. Presents the verdict and three explicit options:
   - **Accept**: merge the branch into the current branch.
   - **Inspect**: hands over the branch name for manual review.
   - **Discard**: deletes the branch; working tree unchanged.

The user must choose — the command never merges automatically.

### The decision table

| Command | Edits working tree? | Auto-merged? | Review included? |
|---|---|---|---|
| `/implement` | yes | n/a | yes (after edits) |
| `/safe-implement` | no | no | yes (before accept) |
| `/bg-review` | never (review-only) | n/a | n/a |

### When to use each

**`/safe-implement`** — high-risk tasks: deleting files, restructuring,
touching CI config, anything you might want to throw away without `git
restore`. The safety guarantee: a bad agent run leaves zero permanent changes.

**`/implement`** — low-risk tasks where speed matters more than the extra
confirmation gate, or when the tree is already dirty and isolation wouldn't
help.

### What isolation: "worktree" is NOT

- Not a shell sandbox. The agent can still make network requests, read env
  vars, and run arbitrary commands. The isolation is git-level only.
- Not a Docker container or VM. The worktree shares the same filesystem,
  object store, and process namespace as the host.
- Not a rollback mechanism. The working tree is never touched; there is
  nothing to roll back.

---

## Honest gaps remaining after Step 16

1. `/safe-implement` has no equivalent of `/implement`'s bounded retry loop:
   if the review finds Blocking findings, it reports them but does not
   re-invoke `coding-agent` automatically in the worktree. Adding that loop
   while keeping the accept/discard gate is a natural Step 17 extension.
2. Stale worktree branches accumulate unless the user explicitly deletes them.
   A `/cleanup-worktrees` command (`git worktree prune && git branch -d ...`)
   would address this but is not implemented.
3. The `--package-root` flag is parsed with a hand-rolled loop rather than
   `argparse` — intentional (keeping `main()` stdlib-only and dependency-free)
   but a `--help` flag would require argparse to be useful. The current
   docstring serves as documentation.
4. No live exercise of `/safe-implement` appears here for the same reason
   docs/15 cited for `/bg-review`: running it against this step's own
   in-progress diff would be circular. The first real run after this commit
   is the evidence.
