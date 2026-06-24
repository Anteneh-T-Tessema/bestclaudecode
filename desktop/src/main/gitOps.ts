/**
 * Shared git/GitHub CLI wrapper — the single place that shells out to `git`
 * and `gh`. git.handlers.ts and github.handlers.ts (renderer-facing IPC) and
 * autonomousAgent.ts (main-process-only, can't reach those IPC handlers)
 * both call into this module rather than each owning their own
 * execFile('git'/'gh', ...) calls, same pattern already applied to
 * chatContext.ts/agentMemory.ts.
 */
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

/** Creates a new worktree at `worktreePath` on a freshly created `branch`, branched off whatever HEAD currently is in `repoRoot`. */
export async function createWorktree(repoRoot: string, worktreePath: string, branch: string): Promise<void> {
  await runGit(repoRoot, ['worktree', 'add', worktreePath, '-b', branch], 60_000)
}

/** Removes a worktree and prunes its git metadata. Throws if the worktree still has uncommitted changes (use `force` to override). */
export async function removeWorktree(repoRoot: string, worktreePath: string, force = false): Promise<void> {
  const args = ['worktree', 'remove', worktreePath]
  if (force) args.push('--force')
  await runGit(repoRoot, args, 30_000)
}

export async function commitAll(cwd: string, message: string): Promise<{ committed: boolean }> {
  await runGit(cwd, ['add', '-A'])
  const status = await runGit(cwd, ['status', '--porcelain'])
  if (!status.trim()) return { committed: false } // nothing to commit
  await runGit(cwd, ['commit', '-m', message])
  return { committed: true }
}

export async function push(cwd: string, branch: string, remote = 'origin'): Promise<void> {
  await runGit(cwd, ['push', '--set-upstream', remote, branch], 60_000)
}

export async function createPr(
  cwd: string,
  opts: { title: string; body: string; base: string; head: string },
): Promise<string | null> {
  try {
    const { stdout } = await exec(
      'gh',
      ['pr', 'create', '--title', opts.title, '--body', opts.body, '--base', opts.base, '--head', opts.head],
      { cwd },
    )
    return stdout.trim()
  } catch {
    return null
  }
}
