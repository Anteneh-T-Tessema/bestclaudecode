# Step 12: Parallel agent execution and the diff-scoping fix

Two features. One demonstrates a new execution pattern (parallel fan-out);
the other closes a silent failure mode discovered live in Step 11.

---

## Feature 1: `/parallel-review` — parallel agent fan-out

Every prior orchestration command in this repo runs subagents sequentially:
`/blueprint` chains four spec-writers one after another; `/implement` runs
coding-agent then code-reviewer (and possibly coding-agent again); `/blueprint-build`
does the same. All of these call `Agent` once, wait for the result, then decide
what to call next.

`/parallel-review` is the first command that launches multiple Agent calls
**in a single response**, all in flight simultaneously.

### How it works

```
/parallel-review src/foo.py src/bar.py src/baz.py
```

The assistant determines the diff scope for each path (same logic `/review`
uses: diff for the path, or full file if no diff), then emits three `Agent`
tool calls in one response — one `code-reviewer` per path. All three run
concurrently. Once all report back, the assistant aggregates:

1. A top-line verdict: `N blocking, M should-fix, K nits/notes across 3 files`
2. All findings sorted by severity across all files (Blocking → Should-fix →
   Nit/Note), each tagged with its source path
3. Repeated patterns grouped under one header rather than repeated N times

### Why this matters

Sequential subagent calls are fine for dependent work (you need the PRD before
you write the SRS). Parallel execution is the right pattern when the work is
independent — reviewing three unrelated files doesn't require waiting for the
first review to finish before starting the second. The pattern generalizes to
any fan-out over independent units: summarize N documents, translate N strings,
lint N files.

The command also handles edge cases explicitly:
- 0 args: ask rather than guess
- 1 arg: fall through to single-reviewer behavior (no overhead for trivial case)
- path not found: note it per-path in the report, don't fail the whole command

### What was verified

Structural: the command file parses correctly, registers immediately as a skill
(visible in the system-reminder the moment the file was created), and has no
name collision with any existing global skill. The scope-determination and
aggregation logic mirrors `/review`'s established patterns exactly.

Live test: not run in this step — exercising parallel fan-out requires an
interactive session with multiple real files having actual diffs or content to
review. The honest state is: the command is designed and specified, the pattern
it demonstrates (`Agent` fan-out) is a documented Claude Code capability, but
the multi-agent concurrent execution path hasn't been triggered here. This is
the same gap that existed for `/implement`'s retry path after Step 11 — design
verified, execution path not triggered.

---

## Feature 2: The untracked-file diff-scoping fix

### The gap

Discovered live during Step 11's `/implement` test. After coding-agent created
`src/repo_map.py` and `src/tests/test_repo_map.py` (new, untracked files), the
diff-scoping fallback chain in both `/review` and `/implement` returned empty:

```
git diff         → empty (nothing unstaged)
git diff HEAD    → empty (new files not staged)
merge-base diff  → empty (no prior commits include these files)
```

The result was a silent non-review: `code-reviewer` was told "here is your
scope: (empty)" and reported zero findings — not because the code was clean, but
because the diff tool chain never showed it the code at all.

The workaround at the time: `/review`'s own "no diff → review the full file"
path-argument fallback caught it when re-run with explicit paths. But the root
cause — new untracked files being invisible to all three git diff variants —
was never addressed.

### The fix

Added a step 4 to the fallback chain in both `review.md` and `implement.md`:

> If all three git diff variants return empty, run `git status --porcelain`
> and check for lines starting with `??`. If any exist, surface them
> explicitly rather than producing a silent empty review.

The surface message is: "the diff is empty but there are N untracked file(s):
[list]; `git add` them to include in `git diff HEAD`, or pass their paths
directly as arguments."

### Why surface-and-explain rather than auto-`git add`

Auto-staging would be overreach in an educational tool:
- `git add` is an intentional act with scope implications (it affects what
  goes into the next commit, not just what gets reviewed).
- The user may have untracked files they explicitly don't want staged yet.
- Staging silently to make the review work would hide the actual gap from the
  user, who wouldn't learn why the review was empty in the first place.

Surface-and-explain is the right default. An advanced version could offer both
options interactively, but that's scope creep for what is fundamentally a
diagnostic improvement.

### What was verified

The fix is textual (command descriptions, not executable code), so there's no
lint/test suite to run against it. Correctness was verified by reading the
updated files and confirming the new step fits syntactically into the existing
numbered list structure without breaking the routing logic.

---

## What this step adds to the repo's feature surface

| Feature | What it demonstrates |
|---|---|
| `/parallel-review` | Multiple `Agent` calls in one response — parallel subagent fan-out |
| Diff-scoping fix | Defensive gap-closure based on a real failure discovered in Step 11 |

The combination of these two is intentional: the fan-out pattern (`/parallel-review`)
is the new capability; the diff-scoping fix is the maintenance work that keeps
the existing capability (`/review`, `/implement`) honest. Real agentic systems
need both.

---

## Honest gaps remaining after Step 12

1. `/parallel-review` live test not run (same as `/implement`'s retry path
   after Step 11 — design proven, execution path not exercised).
2. The aggregation step (merging N reviewer reports) is described in the
   command spec but not tested end-to-end. De-duplication of cross-file
   repeated patterns requires the assistant to recognize the same finding
   across multiple reviewers' outputs — that's pattern-matching over natural
   language, which may or may not deduplicate cleanly in practice.
3. The diff-scoping fix surfaces untracked files but doesn't cover a related
   case: files that exist but have been `git rm`'d (deleted from tracking but
   still present on disk). `git status --porcelain` would show these with a `D`
   prefix, not `??` — they'd still be invisible to the fallback chain. Narrow
   enough to leave for a future step.
