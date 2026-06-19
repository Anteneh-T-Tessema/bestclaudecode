---
description: Implement a task via coding-agent running in an isolated git worktree — edits land on a throw-away branch, not your working tree. Review the diff before accepting. Use instead of /implement when you want to see what the agent would change before it touches your files.
argument-hint: <task description>
---
This command demonstrates **worktree isolation** — the first command in this
repo that passes `isolation: "worktree"` to an Agent call. Every other
command here (`/implement`, `/blueprint-build`) lets `coding-agent` edit the
working tree directly. This one does not: the agent works on a temporary copy
of the repo on a fresh branch, its changes are isolated until you explicitly
accept them.

## What isolation: "worktree" does

When `isolation: "worktree"` is set on an Agent call:

1. Claude Code creates a temporary git worktree — a separate directory that
   shares the same git history but has a clean working tree on a new branch.
2. The agent runs against that worktree. All edits, writes, and test runs
   happen inside it, not in your current working directory.
3. If the agent makes no changes, the worktree is cleaned up automatically
   and nothing is returned.
4. If the agent makes changes, the worktree path and branch name are returned
   to the orchestrating session so you can inspect the diff and decide whether
   to merge, cherry-pick, or discard.

The agent itself doesn't know it's in a worktree — it sees the same files
and the same git history. The isolation is transparent to the subagent.

## Execution

1. If `$ARGUMENTS` is empty, ask the user to describe the task — do not guess.

2. Spawn `coding-agent` with **`isolation: "worktree"`** and the task from
   `$ARGUMENTS`. Tell it to plan, implement, verify (lint + tests), and
   report back with what it changed.

3. When it returns, check whether it reports changes or a no-op:
   - **No changes**: tell the user the agent found nothing to do and the
     worktree was discarded. Done.
   - **Changes made**: proceed to step 4.

4. Run `git diff <base-branch>..<worktree-branch>` to get the full diff of
   what the agent produced in isolation. (The worktree branch name is in the
   agent's result.)

5. Delegate that diff to `code-reviewer` for a critique (same as `/implement`
   does). Report the review's verdict.

6. Present the user with three options:
   - **Accept**: merge or cherry-pick the worktree branch into the current
     branch (`git merge --no-ff <branch>` or `git cherry-pick <sha-range>`).
   - **Inspect**: tell the user the branch name so they can check it out and
     review manually before deciding.
   - **Discard**: delete the worktree branch. The working tree is unchanged.

   Do not merge automatically — the user must confirm. This is the safety
   guarantee that makes the command different from `/implement`.

## Why this is different from /implement

`/implement` lets `coding-agent` edit the working tree directly. If the agent
makes a bad change, you need to `git checkout` or `git restore` to undo it.

`/safe-implement` keeps the working tree clean until you say so. The cost is
an extra review step; the benefit is that a bad agent run produces zero
permanent changes.

Use `/safe-implement` when:
- The task is high-risk (deleting files, restructuring, touching CI config).
- You want to review the full diff before anything is staged.
- You are experimenting and might want to throw the result away.

Use `/implement` when:
- The task is low-risk or the working tree is already dirty and you don't
  need isolation.
- Speed matters more than the extra safety gate.

## Honest limitations

1. The worktree branch persists until you explicitly merge or delete it —
   accumulated stale branches need manual cleanup (`git branch -d`).
2. If the agent runs tests that require external state (a running database,
   a live server), those may behave differently inside the worktree because
   the working directory is different.
3. The worktree shares the same `.git` object store, so large files the agent
   writes are not truly isolated — they exist in the repo's object graph even
   if the branch is deleted (until `git gc` runs).
4. `isolation: "worktree"` is a parameter on the Agent tool call — it is not
   a shell sandbox. The agent can still make network requests, read env vars,
   and execute arbitrary shell commands; the isolation is git-level only.
