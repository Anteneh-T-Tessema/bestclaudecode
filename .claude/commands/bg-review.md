---
description: Start a code-reviewer subagent in the background — returns immediately with a job-started confirmation, then notifies when the review is done. Use instead of /review when you want to keep working while a review runs.
argument-hint: [path]
---
This command demonstrates **background agent execution** — the first command
in this repo that spawns a subagent with `run_in_background: true`. Every
other command here (`/review`, `/parallel-review`, `/implement`) blocks until
its subagents finish. This one does not: it fires the reviewer, returns a
confirmation immediately, and the harness notifies when the review completes.

## Routing

- **No arguments**: determine the diff scope the same way `/review` does —
  `git diff` (unstaged); if empty → `git diff HEAD`; if empty → diff against
  the upstream merge-base with the default branch; if still empty → run
  `git status --porcelain` and surface any untracked files explicitly rather
  than producing a silent empty review.
- **One argument**: use `git diff -- <path>` as the scope; if empty, review
  the full file or directory at that path.

## Execution

1. Derive the diff or path scope per the routing rules above.
2. Spawn exactly **one `code-reviewer` instance with `run_in_background: true`**.
   Pass it:
   - The full diff or path scope.
   - The instruction to categorize findings as Blocking / Should-fix / Nit / Note.
   - A reminder that it cannot edit anything.
3. **Return immediately** — do not wait for the reviewer to finish. Tell the
   user:
   - That the review has started in the background.
   - What scope it is reviewing (path or diff summary — e.g., "3 files, +47/-12 lines").
   - That Claude will notify them automatically when the review is done.
4. When the background agent completes, the harness re-invokes this session
   automatically. At that point, report the reviewer's full findings verbatim,
   using the same severity-sorted format `/review` and `/parallel-review` use:
   top-line verdict, then Blocking → Should-fix → Nit/Note.

## Why this is different from /review

`/review` blocks: you cannot interact with Claude while the reviewer runs.
`/bg-review` does not block: you can ask questions, run other commands, or
start other background agents while the review runs. The tradeoff is that you
do not get results immediately — you get a notification when the review is done.

Use `/bg-review` when:
- The diff is large and you want to keep working.
- You are starting multiple background reviews in parallel (each is a separate
  `/bg-review` invocation; for true fan-out over multiple paths in one command,
  use `/parallel-review` instead).

Use `/review` when:
- You want to block and get findings before doing anything else.
- The diff is small and latency does not matter.

## Honest limitations

- The harness notification that re-invokes this session is automatic, but the
  timing depends on the reviewer's runtime. For large diffs on slower models,
  this can be tens of seconds to a few minutes.
- If the session ends before the background agent completes, the findings are
  lost — the harness only notifies the active session.
- `run_in_background: true` is an Agent call parameter, not a shell `&` — the
  agent runs inside the Claude Code process, not as a separate OS process.
