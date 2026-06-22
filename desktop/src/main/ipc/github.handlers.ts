import { ipcMain } from 'electron'
import { runPythonJson, runCommand } from '../pythonBridge'
import { repoRoot } from '../paths'

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
    try {
      const result = await runCommand(
        'gh', ['pr', 'create', '--title', title, '--body', body, '--base', base, '--head', head],
        repoRoot(),
      )
      const url = result.stdout.trim()
      return { url }
    } catch {
      return null
    }
  })
}
