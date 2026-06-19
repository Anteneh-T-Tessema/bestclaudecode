---
description: Fan out code-reviewer subagents in parallel across multiple paths, then aggregate findings into a single severity-sorted report. Use instead of /review when you want to critique several files or directories simultaneously rather than one at a time.
argument-hint: <path1> [path2] [path3] ...
---
This command's purpose is to demonstrate **parallel agent execution** — the
first command in this repo that launches multiple subagent instances in a
single response. Every other orchestration command here (blueprint, implement,
blueprint-build) runs subagents sequentially. This one runs N of them at once.

## Routing

- **No arguments**: ask the user which paths to review — do not guess.
- **Exactly one argument**: delegate to a single `code-reviewer` instance (same
  as `/review`'s path case — no parallelism needed or demonstrated).
- **Two or more arguments**: fan out one `code-reviewer` per path, all in
  parallel, then aggregate (see below).

## Scope per path (same rule as `/review` uses for its path argument)

For each path in `$ARGUMENTS`:
1. Run `git diff -- <path>` to get the change set for that path.
2. If the diff is empty, review the full file / directory at that path instead.
3. If the path does not exist, note it in the aggregated report as
   "path not found — skipped" and continue; don't fail the whole command.

## Parallel execution

When 2+ paths are given, launch **one `code-reviewer` Agent call per path in a
single response** — all in parallel. Tell each instance:
- The exact diff or path scope you determined for its path.
- That it should return structured findings using the same severity labels it
  always uses: Blocking, Should-fix, Nit, Note.
- That it should **not** edit anything (it can't; its tools are read-only by
  construction, but say it anyway for clarity).

Do not start aggregating until all parallel instances have reported back.

## Aggregation

Merge all findings into a single report:

1. **Top-line verdict** (one line): `N blocking, M should-fix, K nits/notes
   across P file(s)` — or "no findings across P file(s)" if all are clean.
2. **Findings by severity**, across all files:
   - All **Blocking** findings first (most urgent, file:line cited, one entry per finding)
   - All **Should-fix** findings next
   - All **Nit** / **Note** findings last
3. Under each finding, include the file path so the reader knows which reviewer
   flagged it (format: `[path] file:line — description`).
4. If the same issue appears in multiple files (e.g., missing type annotation on
   a pattern repeated everywhere), group them under a single header and list the
   locations rather than repeating the full description N times.

## What to report verbatim

Report the aggregated findings as described above. Do not soften Blocking
findings ("might be worth fixing") or suppress Nit-level findings ("too minor
to mention"). The user asked for a review; give them the complete picture.
