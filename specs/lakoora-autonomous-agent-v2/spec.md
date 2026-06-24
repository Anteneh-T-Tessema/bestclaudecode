# Spec: Sandboxed, self-shipping autonomous agent

## 1. Current state (verified against the code)

`desktop/src/main/agents/autonomousAgent.ts`'s `startAutonomousSession()` runs a
task plan subtask-by-subtask: prompt the model, parse `<<<EDIT>>>`/`<<<RUN>>>`/
`<<<BROWSE>>>` blocks out of the response, apply them, retry once on failure,
mark done, advance. Three real gaps, all verified directly against the code,
not assumed:

1. **No isolation.** `applyEdit()` writes straight to `projectPath` (the user's
   live working directory) via `fs.writeFile`. `runCommand()` executes shell
   commands with `cwd: projectPath` directly. There is no branch, no worktree,
   nothing standing between the agent's edits and the user's actual files.
2. **No shipping step.** When `pending.length === 0`, the loop broadcasts
   `status: 'finished'` and stops. It never commits, never pushes, never
   opens a PR — even though the primitives for all of that already exist
   elsewhere in this codebase and are simply never called from here:
   - `desktop/src/main/ipc/git.handlers.ts` already wraps `git` via a local
     `git(cwd, args, timeout)` helper, with working IPC handlers for
     `git:createBranch`, `git:add`, `git:commit`, `git:push`, `git:status`.
   - `desktop/src/main/ipc/github.handlers.ts`'s `github:createPr` already
     shells out to `gh pr create --title --body --base --head` and returns
     the PR URL.
   These are IPC handlers (renderer-callable only) — `autonomousAgent.ts` is
   main-process code and can't call `window.api.git.*` directly, which is
   presumably *why* nobody wired this up yet: the primitive existed in the
   wrong layer for this caller. Same "exists but unwired" shape as the
   Context/Memory Engine work that preceded this spec.
3. **No structured test feedback.** `RUN` block failures retry with raw
   `stderr` as the only signal. There's no recognition that a command was a
   *test run* specifically, so the model doesn't get a parsed pass/fail
   summary back — just whatever text the test runner happened to print.

There is also no deployment capability anywhere in the repo (confirmed via
grep — zero deploy/CI-trigger code) and no real sandboxing technology
(Docker, VM) anywhere either.

## 2. Scope decisions (made explicitly, not left implicit)

- **Sandboxing = local git worktree, not Docker or a cloud VM.** This is a
  desktop Electron app; provisioning real cloud VMs means choosing a
  provider, an account, and a billing model — a decision for the product
  owner to make deliberately, not something to default into while closing
  out a feature list. A git worktree is zero-dependency, instant, ships
  today, and solves the actual problem this gap names: the agent currently
  mutates the user's live working tree directly. Worktree isolation fixes
  exactly that. True remote/cloud execution (Cursor/Devin's actual Layer 9)
  is a separate, much larger infrastructure project — explicitly out of
  scope here, and should be its own spec if pursued later.
- **PR creation and deployment are fully autonomous, per explicit instruction**
  — no approval gate before push/PR/deploy. The safety nets below are
  engineering defaults (never push to the branch you forked from, never
  invent flags a project didn't define, never deploy without a detected
  deploy mechanism), not confirmation prompts — those stay in place
  regardless of the autonomy setting because they're correctness properties,
  not friction.
- **Deployment only runs what the project already defines.** No new deploy
  config gets authored on a project's behalf. Detect, in priority order: a
  `"deploy"` script in `package.json` → run `npm run deploy`; otherwise a
  `vercel.json` or `.vercel/` directory → run `vercel` (no `--prod` flag —
  Vercel's own default is a preview deployment, which is the right default
  here without this spec needing to invent a prod/preview distinction
  itself); otherwise nothing — skip deployment silently, don't error the
  session over it.

## 3. Design

### 3.1 Shared git/GitHub helper module (avoid duplicating the lesson learned twice already)

New `desktop/src/main/gitOps.ts`:

```ts
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

export async function runGit(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout })
  return stdout.trim()
}

export async function createBranch(cwd: string, branch: string): Promise<void> {
  await runGit(cwd, ['checkout', '-b', branch])
}

export async function commitAll(cwd: string, message: string): Promise<{ committed: boolean }> {
  await runGit(cwd, ['add', '-A'])
  const status = await runGit(cwd, ['status', '--porcelain'])
  if (!status.trim()) return { committed: false } // nothing to commit
  await runGit(cwd, ['commit', '-m', message])
  return { committed: true }
}

export async function push(cwd: string, branch: string): Promise<void> {
  await runGit(cwd, ['push', '--set-upstream', 'origin', branch])
}

export async function createPr(cwd: string, opts: { title: string; body: string; base: string; head: string }): Promise<string | null> {
  try {
    const { execFile: ef } = await import('child_process')
    const { promisify: p } = await import('util')
    const e = p(ef)
    const { stdout } = await e('gh', ['pr', 'create', '--title', opts.title, '--body', opts.body, '--base', opts.base, '--head', opts.head], { cwd })
    return stdout.trim()
  } catch {
    return null
  }
}
```

(Exact shape is a suggestion, not a contract — the implementer should look at
`git.handlers.ts`'s existing private `git()` helper and `github.handlers.ts`'s
`github:createPr` handler and factor out the common logic rather than
reimplement it twice. Refactor `git.handlers.ts` and `github.handlers.ts` to
call into this module instead of duplicating the `execFile('git'/'gh', ...)`
calls — same pattern already applied to `chatContext.ts`/`agentMemory.ts`
earlier in this series.)

### 3.2 Worktree lifecycle in `autonomousAgent.ts`

At the start of `startAutonomousSession`, before the main loop:

1. Generate a branch name, e.g. `agent/<slug>-<shortid>`.
2. Create a worktree off the current branch: `git worktree add <path> -b <branch>`
   (a new git primitive, add to `gitOps.ts`: `createWorktree(repoRoot, path, branch)`).
   Put the worktree under a scratch location, e.g. `<projectPath>/.lakoora-worktrees/<branch>/`
   (already a sensible candidate for the `.gitignore` entry pattern established
   by Gap 32's `.cache/` addition — add this directory to `.gitignore` too if
   it isn't already covered by a wildcard).
3. From here on, every `applyEdit`/`runCommand`/`executeBrowse` call in the
   loop operates against the **worktree path**, not `projectPath` directly.
   This is the actual isolation: the agent's edits never touch the user's
   checked-out working directory at all until they're merged via PR.
4. If worktree creation fails for any reason (e.g. `projectPath` isn't a git
   repo) — fall back to today's behavior (operate directly on `projectPath`)
   rather than failing the whole session. Log this fallback in the broadcast
   so the UI can show it, but don't block on it; not every project Lakoora
   opens is necessarily a git repo.

### 3.3 Finalize step (on `'finished'`, replacing the current bare broadcast-and-break)

When `pending.length === 0`:

1. `commitAll(worktreePath, summary of the goal)` — if nothing changed, skip
   straight to cleanup (delete the worktree, nothing to ship).
2. `push(worktreePath, branch)` — if this fails (no remote, no auth), broadcast
   a new status (see 3.5) explaining the branch exists locally only, and
   **do not delete the worktree** — that's the only copy of unshippable work,
   don't destroy it.
3. `createPr(...)` — if this fails (no `gh`, not authenticated), same rule:
   broadcast that the branch pushed but no PR was opened, leave the worktree
   alone (the user can open the PR by hand from the pushed branch).
4. Only on full success (pushed + PR opened) does cleanup run: remove the
   worktree directory and prune it from git (`git worktree remove`).
5. **Then**, attempt deployment per the detection rule in §2 — this runs
   from the worktree (or, if you've already cleaned it up because you're
   deploying after merge — your call on ordering, but the simpler and safer
   sequencing is: deploy detection + run happens *before* worktree cleanup*,
   against the worktree's checked-out state, since that's the code that was
   actually tested in this session).

### 3.4 Structured test-and-iterate

In the existing RUN-block handling (`parseRuns`/the run-error branch), detect
whether a command looks like a test run via a simple pattern match (e.g.
`/\b(pytest|jest|vitest|go test|npm test|npm run test|cargo test)\b/`). If so,
after running it, parse the tail of stdout/stderr for a pass/fail summary
(test runners' own summary lines — e.g. pytest's `"N passed, M failed"`,
jest/vitest's `"Tests: N failed, M passed"` — match a small set of known
formats; if none match, fall back to passing the raw output as today) and feed
that structured summary into the retry prompt (`retryContext`) instead of, or
in addition to, the raw stderr. This is a relatively small, additive change to
the existing run-error branch — don't restructure the surrounding retry loop.

### 3.5 Progress reporting

Extend `AgentProgress`'s `status` union (defined in both
`autonomousAgent.ts` and duplicated in `AgentProgressPanel.tsx` — update
both, they're intentionally not shared since one is main-process and one is
renderer-local display state, same existing pattern) with new values as
needed for: creating a branch/worktree, finalizing (commit/push/PR), PR
opened (carry the PR URL in a new optional field), push-failed-kept-locally,
deploying, deployed (carry a deploy URL/output field if the tool reports
one). Render these in `AgentProgressPanel.tsx`'s existing `StatusIcon`/banner
— follow the existing icon-per-status pattern, don't redesign the panel.

## 4. Safety nets (apply regardless of the "fully autonomous" setting — these are correctness, not friction)

- Never `git push` to the branch the worktree was created from; the agent
  only ever pushes its own freshly created `agent/...` branch.
- Never force-push.
- Never delete a worktree that hasn't been successfully pushed *and* PR'd —
  unshippable work stays on disk for manual recovery.
- Never invent a deploy command beyond what's detected per §2's priority list.
- The existing `BLOCKED` regex safety list in `autonomousAgent.ts` (blocking
  `rm -rf /`, fork bombs, `dd if=/dev/zero`, `mkfs`) already applies to every
  `RUN` block regardless of cwd — confirm it still applies correctly when the
  cwd is the worktree path, not `projectPath` (it should, since the check is
  on the command string, not the path) — no change needed there, just confirm
  with a test.

## 5. Verification

- `.venv/bin/pytest src/tests/ -q` and `.venv/bin/ruff check src` — only if any
  Python is touched (unlikely; this spec is TS-only as currently scoped).
- `npm run typecheck` and `npm test` in `desktop/` must be clean.
- Add tests for `gitOps.ts`'s new functions against a real temp git repo
  (`tmp_path`-style fixture, create a repo with `git init`, a commit, then
  exercise `createWorktree`/`commitAll`/`push`-against-a-local-bare-remote if
  feasible, or at minimum `createWorktree`/`commitAll` which don't need a
  remote).
- Manually trace the full finalize sequence by reading the diff: confirm
  worktree creation, the commit/push/PR happy path, and at least one failure
  branch (e.g. push fails because there's no remote) leaves the worktree
  intact rather than deleting it.
- Confirm `git.handlers.ts`/`github.handlers.ts`'s existing IPC behavior is
  unchanged after refactoring them onto `gitOps.ts` (existing renderer
  callers shouldn't notice any difference).
