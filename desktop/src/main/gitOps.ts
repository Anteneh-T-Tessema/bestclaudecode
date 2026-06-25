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

export interface GithubListItem {
  number: number
  title: string
  url: string
  author: string
  state: string
  updatedAt: string
  isDraft?: boolean
  labels?: string[]
}

// Gap 100 — browse open PRs/issues without already knowing the number.
export async function listPrs(cwd: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GithubListItem[]> {
  try {
    const { stdout } = await exec('gh', [
      'pr', 'list', '--state', state, '--limit', '30',
      '--json', 'number,title,url,author,state,updatedAt,isDraft',
    ], { cwd })
    const raw = JSON.parse(stdout) as Array<{ number: number; title: string; url: string; author: { login: string }; state: string; updatedAt: string; isDraft: boolean }>
    return raw.map((r) => ({
      number: r.number, title: r.title, url: r.url, author: r.author?.login ?? 'unknown',
      state: r.state, updatedAt: r.updatedAt, isDraft: r.isDraft,
    }))
  } catch {
    return []
  }
}

export async function listIssues(cwd: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GithubListItem[]> {
  try {
    const { stdout } = await exec('gh', [
      'issue', 'list', '--state', state, '--limit', '30',
      '--json', 'number,title,url,author,state,updatedAt,labels',
    ], { cwd })
    const raw = JSON.parse(stdout) as Array<{ number: number; title: string; url: string; author: { login: string }; state: string; updatedAt: string; labels: Array<{ name: string }> }>
    return raw.map((r) => ({
      number: r.number, title: r.title, url: r.url, author: r.author?.login ?? 'unknown',
      state: r.state, updatedAt: r.updatedAt, labels: r.labels?.map((l) => l.name) ?? [],
    }))
  } catch {
    return []
  }
}

// Gap 101 — review a PR from the IDE: comment, approve, or request changes.
export async function commentOnPr(cwd: string, number: number, body: string): Promise<boolean> {
  try {
    await exec('gh', ['pr', 'comment', String(number), '--body', body], { cwd })
    return true
  } catch {
    return false
  }
}

export async function reviewPr(
  cwd: string,
  number: number,
  action: 'approve' | 'request-changes' | 'comment',
  body?: string,
): Promise<boolean> {
  try {
    const flag = action === 'approve' ? '--approve' : action === 'request-changes' ? '--request-changes' : '--comment'
    const args = ['pr', 'review', String(number), flag]
    if (body) args.push('--body', body)
    await exec('gh', args, { cwd })
    return true
  } catch {
    return false
  }
}

export async function getPrDiff(cwd: string, number: number): Promise<string> {
  try {
    const { stdout } = await exec('gh', ['pr', 'diff', String(number)], { cwd })
    return stdout
  } catch {
    return ''
  }
}

export interface DraftReviewComment {
  path: string
  line: number
  body: string
}

export async function postPrReview(
  cwd: string,
  number: number,
  opts: { body: string; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; comments: DraftReviewComment[] },
): Promise<boolean> {
  try {
    const { stdout: repoOut } = await exec('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd })
    const repo = repoOut.trim()
    const payload = JSON.stringify({
      body: opts.body,
      event: opts.event,
      comments: opts.comments.map((c) => ({ path: c.path, line: c.line, body: c.body, side: 'RIGHT' })),
    })
    await exec('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--method', 'POST', '--input', '-'],
      { cwd, input: payload } as Parameters<typeof exec>[2] & { input: string })
    return true
  } catch {
    return false
  }
}
