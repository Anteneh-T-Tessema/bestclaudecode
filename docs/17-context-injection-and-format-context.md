# Step 17: Context injection (/context-implement) and format_context()

Two changes. The primary new capability is **context injection** — the first
command in this repo that pre-computes a repo map and passes it directly into
the subagent's prompt, so the agent arrives knowing the codebase layout
instead of discovering it through exploratory reads. The warmup closes the
Step 16 documented gap: `/safe-implement` now has a bounded retry loop for
Blocking review findings.

---

## Warmup: bounded retry in /safe-implement

Step 16 documented: "/safe-implement has no equivalent of /implement's
bounded retry loop: if the review finds Blocking findings, it reports them
but does not re-invoke coding-agent automatically."

The fix adds a step 8–9 retry block to `.claude/commands/safe-implement.md`:
if the first review returns Blocking findings, the agent is re-invoked once
with the specific findings (file:line citations). The second review is then
reported verbatim — no further retries. This matches the loop in `/implement`
while keeping the accept/inspect/discard gate intact.

---

## Feature: context injection

### Problem: the explorer tax

When an agent is given a task on an unfamiliar codebase, its first several
turns are spent reading files to understand the layout — what exists, where
things live. That exploratory phase:

- Consumes context window on orientation rather than the task itself.
- Produces shallow reads (skimming to decide relevance).
- Delays the first substantive edit.

For the same reason you'd hand a new colleague an architecture diagram before
asking them to fix a bug, pre-computing a compact layout summary and injecting
it into the agent's prompt short-circuits this phase.

### src/context.py — format_context()

The new module lives at `src/context.py` and exports one function:

```python
def format_context(
    root: Path,
    task: str,
    *,
    include_deps: bool = False,
    package_root: Path | None = None,
    max_map_lines: int = 200,
) -> str:
```

It calls `build_repo_map(root, ...)`, trims the output to `max_map_lines`,
wraps it in a labelled code fence, and appends the task description after a
separator. The caller passes the returned string directly as the agent's
prompt. No network calls, no side effects — pure transformation.

Output structure:

```
## Repo orientation (auto-generated, read before starting)

```
src/context.py
  def format_context() -- line 24

src/repo_map.py
  def build_repo_map() -- line 142
  ...
```

---

## Task

<user's task here>
```

The `max_map_lines` cap (default 200) bounds the injection size — on a large
repo, the trimmed map is more useful than a 2000-line dump that fills the
context window before the task appears.

### Tests (src/tests/test_context.py)

Eight tests, all passing as of this commit:

| Test | What it verifies |
|---|---|
| `test_format_context_contains_orientation_header` | output has both section headers |
| `test_format_context_includes_repo_map_symbols` | agent symbols appear in output |
| `test_format_context_task_appears_after_separator` | task follows orientation, not before |
| `test_format_context_truncates_at_max_map_lines` | truncation note added when over cap |
| `test_format_context_no_truncation_when_map_fits` | no note when map fits |
| `test_format_context_include_deps_adds_imports_line` | `include_deps=True` passes through |
| `test_format_context_wraps_map_in_code_fence` | output contains a code fence |
| `test_format_context_empty_repo_still_returns_valid_prompt` | graceful on empty tree |

30 tests total across the project; all pass.

### /context-implement command

`.claude/commands/context-implement.md` orchestrates:

1. Run `python -m src.repo_map` against the project root (read-only shell
   command, not delegated).
2. Build the injected prompt using the `format_context` structure.
3. Delegate to `coding-agent` with the orientation block + task.
4. Diff, review, bounded-retry loop — identical to `/implement`.

The key difference from `/implement`:

| | `/implement` | `/context-implement` |
|---|---|---|
| Agent knows repo layout | no — discovers by reading | yes — injected upfront |
| First turns spent on | orientation reads | the task itself |
| Context window used for | discovery + task | task (orientation is compact) |

### What context injection is NOT

- Not a RAG retrieval system — the full repo map is injected, not a
  query-ranked subset. For large repos, the `max_map_lines` cap is a blunt
  truncation, not semantic relevance ranking.
- Not a substitute for reading files — the map lists symbols and line numbers
  but not signatures, types, or implementation. The agent still reads files;
  it just goes directly to the right ones.
- Not a live index — the map is a snapshot taken at command invocation time.
  New files the agent creates are not reflected in the orientation block.

---

## Relationship to the repo map tool (src/repo_map.py)

Steps 1–16 built `repo_map.py` as a standalone tool — useful for humans
inspecting codebases. Step 17 is the first step where the tool is used *as
agent context*: the repo map output is not printed to the terminal but piped
directly into a subagent's prompt. This closes the loop between the tooling
and the agent-orchestration track.

---

## Honest gaps remaining after Step 17

1. The `--deps` flag is available in `format_context(include_deps=True)` but
   not exposed as a `/context-implement --deps` argument — the command's
   argument parser would need to split `$ARGUMENTS` into flags and task text.
2. No live exercise of `/context-implement` appears here (same reason as
   docs/15 and docs/16 — circular if run against this step's own diff).
3. The map is a full symbol dump, not relevance-ranked. For large repos, a
   task-aware retrieval step (embed the task, retrieve top-k symbols) would
   be more useful than the blunt `max_map_lines` cap.
4. `format_context` is synchronous. For very large repos where `build_repo_map`
   is slow, an async or cached variant would reduce the upfront latency.
