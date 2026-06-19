---
description: Implement a task via coding-agent with a pre-computed repo map injected as orientation context — agent gets a file/symbol layout before it starts, reducing exploratory reads. Same review-and-fix loop as /implement.
argument-hint: <task description>
---
This command demonstrates **context injection** — the first command in this
repo that pre-computes structured information about the codebase and passes
it directly into a subagent's prompt, rather than letting the agent discover
the repo from scratch through exploratory reads.

Every other command here (`/implement`, `/safe-implement`, `/blueprint-build`)
delegates a task and lets the agent orient itself. This one orients the agent
*before* it starts.

## What context injection is

An agent given a task on an unfamiliar codebase typically spends its first
several turns reading files to understand what exists and where. That
exploratory phase consumes context window and often produces shallow reads
(skimming a file to decide whether it's relevant). Pre-computing a structured
summary — a repo map — and injecting it as the opening block of the agent's
prompt short-circuits that phase: the agent arrives knowing the layout.

The repo map used here is produced by `src/context.py:format_context()`,
which wraps `src/repo_map.py:build_repo_map()`. The output looks like:

```
## Repo orientation (auto-generated, read before starting)

```
src/context.py
  def format_context() -- line 24

src/repo_map.py
  def build_repo_map() -- line 142
  def main() -- line 181
  ...
```

---

## Task

<user's task here>
```

The agent reads the orientation block, knows which files and functions exist,
and can go directly to the relevant ones.

## Flags

Parse `$ARGUMENTS` before passing it to the agent:

- **`--deps`** — if present, pass `--deps` to `python -m src.repo_map` so
  cross-file import lines appear in the orientation block. Remove `--deps`
  from the task text before injecting it.
- **`--cached`** — if present, use `python -m src.cached_context` to load the
  repo map from disk cache (`.context-cache/`) instead of recomputing it.
  The cache is mtime-validated; a stale or missing cache is rebuilt
  automatically. Remove `--cached` from the task text. Can be combined with
  `--deps`.

Both flags are optional and can be combined: `--deps --cached <task>`.

## Execution

1. If `$ARGUMENTS` (after stripping flags) is empty, ask the user to describe
   the task.

2. Build the repo map:
   - With `--cached`: run `python -m src.cached_context [--deps]` — reads
     from cache if valid, rebuilds otherwise.
   - Without `--cached`: run `python -m src.repo_map [--deps]` directly.
   This is a read-only shell command — run it yourself, do not delegate it.
   Cap at 200 lines; if the output is longer, append a truncation note.

3. Build the injected prompt using the `format_context` structure:
   ```
   ## Repo orientation (auto-generated, read before starting)

   ```
   <repo map output>
   ```

   ---

   ## Task

   <task text (flags stripped)>
   ```

4. Delegate that full prompt (orientation block + task) to `coding-agent`.
   The agent should plan, implement, verify (lint + tests), and report back.

5. Once it reports back, determine the diff scope the same way `/implement`
   does: `git diff` → `git diff HEAD` → merge-base diff → untracked file
   warning if all are empty.

6. Delegate that diff to `code-reviewer` for a critique.

7. If the review has **zero Blocking findings**: report success — summarize
   what was built and the review's verdict. Done.

8. If the review has **one or more Blocking findings**: re-delegate to
   `coding-agent` exactly once more, giving it the specific Blocking findings
   (cite `file:line`). This retry prompt also includes the repo orientation
   header so the agent retains layout context during the fix pass.

9. Re-run `code-reviewer` against the cumulative diff (not just the retry
   changes). Report the second verdict verbatim. If Blocking findings remain,
   say plainly the change is **not verified clean**. Do not retry again.

## Why this is different from /implement

`/implement` and `/context-implement` run the same review-and-fix loop. The
difference is the agent's starting state:

| | `/implement` | `/context-implement` |
|---|---|---|
| Agent knows repo layout | no — discovers by reading | yes — injected upfront |
| First turns spent on | orientation reads | the task itself |
| Context window used for | discovery + task | task (orientation is compact) |
| Good when | repo is familiar to agent | repo is unfamiliar / large |

The tradeoff is that generating the repo map adds a small upfront cost
(one shell command). For a small repo this is negligible. For a large repo,
the `max_map_lines` cap in `format_context` keeps the injection bounded.

## Honest limitations

1. The repo map is a snapshot taken at command invocation time — if the agent
   creates new files, the map in its prompt will be stale for the remainder
   of the session. This is acceptable because the map is orientation, not
   a live index.
2. The map lists symbols but not their signatures or types. For tasks that
   require understanding *how* a function works (not just that it exists),
   the agent still needs to read the file.
3. Context injection helps most on large, unfamiliar codebases. On a small
   repo the benefit is marginal — the agent would have oriented itself in
   one or two reads anyway.
4. The `--deps` and `--cached` flags are parsed with a simple prefix-strip
   loop rather than `argparse`. Unrecognised flags starting with `--` are
   passed through to the task text unchanged, not rejected.
