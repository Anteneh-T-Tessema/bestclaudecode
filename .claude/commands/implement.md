---
description: Implement a task via coding-agent, then run code-reviewer against the result, with one bounded self-correction retry if Blocking findings come back.
argument-hint: <task description>
---
Delegate the work to `coding-agent` and `code-reviewer` — don't
implement or review anything yourself, the point of this command is to
exercise that loop, the same way `/blueprint` exercises the spec-writer
chain.

1. If `$ARGUMENTS` is empty, ask the user to describe the task instead
   of guessing one.
2. Delegate `$ARGUMENTS` to `coding-agent` as the task to implement
   (plan, edit, verify — its normal operating loop).
3. Once it reports back, determine the diff scope using the same
   fallback `/review` uses: empty → `git diff` (unstaged); if empty →
   `git diff HEAD` (staged + unstaged); if empty → diff against the
   upstream merge-base with the default branch. If all three are empty,
   run `git status --porcelain` and check for `??` lines (untracked
   files). If any exist, surface them explicitly — "the diff is empty
   but there are N untracked file(s): [list]; `git add` them to include
   in `git diff HEAD`" — rather than producing a silent empty review.
4. Delegate that diff to `code-reviewer` for a critique.
5. If the review's verdict has **zero Blocking findings**, report
   success: summarize what was built and the review's verdict verbatim.
   Then write the audit log (run this shell command yourself — do not
   delegate it):
   `python -m src.decision_log --log --task "<task>" --verdict "LGTM" --retries 0 --outcome "<one-sentence summary>" --agent "coding-agent"`
   Done — no retry needed.
6. If the review reports **one or more Blocking findings**, delegate
   back to `coding-agent` exactly once more: give it the specific
   Blocking findings (cite the same `file:line` the review gave) and
   tell it to fix only those.
7. Re-run `code-reviewer`, this time scoped to the **cumulative diff
   since this command started** (not just a re-check of the original
   findings) — re-derive the diff scope the same way as step 3. This
   catches anything the retry itself introduced, not just whether the
   original findings got fixed.
8. Report the second review's verdict **verbatim**. Write the audit log
   regardless of outcome — pass `--retries 1` and one `--finding` flag
   per Blocking finding the reviewer cited:
   `python -m src.decision_log --log --task "<task>" --verdict "<verdict>" --retries 1 --outcome "<summary>" --agent "coding-agent" --finding "<f1>" --finding "<f2>"`
   If Blocking findings still remain after this one retry, say plainly —
   without softened language like "mostly works" or "should be fine" —
   that the change is **not verified clean**, list the remaining Blocking
   findings, and stop. Don't retry again automatically; this loop is
   bounded at one retry by design.

This is a command-level loop, not something delegated to a subagent's
own prompt — no subagent here has the `Agent` tool, so `coding-agent`
and `code-reviewer` can't call each other directly. Re-using
`coding-agent` for the steps 2 and 6 delegations is safe even though
it's the same subagent twice: it's already loaded for this session, so
this doesn't depend on the kind of mid-session registration lag a
newly-created subagent can hit (see `docs/09-code-reviewer-agent.md`).
