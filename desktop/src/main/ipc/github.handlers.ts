import { ipcMain } from 'electron'
import { runPythonJson } from '../pythonBridge'
import { repoRoot } from '../paths'
import { createPr, listPrs, listIssues, commentOnPr, reviewPr, getPrDiff, postPrReview, type GithubListItem, type DraftReviewComment } from '../gitOps'

export type { GithubListItem, DraftReviewComment }

export interface GithubComment {
  author: string
  body: string
}

export interface GithubItem {
  number: number
  title: string
  body: string
  labels: string[]
  url: string
  kind: 'issue' | 'pr'
  comments: GithubComment[]
}

export function registerGithubHandlers(): void {
  ipcMain.handle('github:fetchIssue', async (_event, number: number): Promise<GithubItem | null> => {
    const result = await runPythonJson(['-m', 'src.github_context', '--issue', String(number), '--json'])
    if (!result.ok) return null
    return result.stats as GithubItem
  })

  ipcMain.handle('github:fetchPr', async (_event, number: number): Promise<GithubItem | null> => {
    const result = await runPythonJson(['-m', 'src.github_context', '--pr', String(number), '--json'])
    if (!result.ok) return null
    return result.stats as GithubItem
  })

  ipcMain.handle('github:createPr', async (
    _event,
    { title, body, base, head }: { title: string; body: string; base: string; head: string },
  ): Promise<{ url: string } | null> => {
    const url = await createPr(repoRoot(), { title, body, base, head })
    return url ? { url } : null
  })

  // Gap 100 — browse open PRs/issues without already knowing the number.
  ipcMain.handle('github:listPrs', async (_event, state?: 'open' | 'closed' | 'all'): Promise<GithubListItem[]> => {
    return listPrs(repoRoot(), state ?? 'open')
  })

  ipcMain.handle('github:listIssues', async (_event, state?: 'open' | 'closed' | 'all'): Promise<GithubListItem[]> => {
    return listIssues(repoRoot(), state ?? 'open')
  })

  // Gap 101 — review comments/approve/request-changes on a PR from the IDE.
  ipcMain.handle('github:commentOnPr', async (_event, { number, body }: { number: number; body: string }): Promise<boolean> => {
    return commentOnPr(repoRoot(), number, body)
  })

  ipcMain.handle('github:reviewPr', async (
    _event,
    { number, action, body }: { number: number; action: 'approve' | 'request-changes' | 'comment'; body?: string },
  ): Promise<boolean> => {
    return reviewPr(repoRoot(), number, action, body)
  })

  ipcMain.handle('github:getPrDiff', async (_event, number: number): Promise<string> => {
    return getPrDiff(repoRoot(), number)
  })

  ipcMain.handle('github:postReviewComments', async (
    _event,
    { number, body, event: evt, comments }: { number: number; body: string; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; comments: DraftReviewComment[] },
  ): Promise<boolean> => {
    return postPrReview(repoRoot(), number, { body, event: evt, comments })
  })
}
