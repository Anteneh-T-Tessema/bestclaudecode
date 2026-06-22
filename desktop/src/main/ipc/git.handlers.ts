import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

async function git(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout })
  return stdout.trim()
}

export interface BlameEntry {
  line: number
  sha: string
  author: string
  timestamp: number
  summary: string
}

function parsePorcelain(out: string): BlameEntry[] {
  const lines = out.split('\n')
  const entries: BlameEntry[] = []
  let i = 0
  while (i < lines.length) {
    const ln = lines[i]
    if (!ln || ln.length < 40 || !/^[0-9a-f]{40} /.test(ln)) { i++; continue }
    const parts = ln.split(' ')
    const sha = parts[0].slice(0, 8)
    const lineNum = parseInt(parts[2], 10)
    i++
    let author = ''
    let timestamp = 0
    let summary = ''
    while (i < lines.length && !lines[i].startsWith('\t')) {
      const cur = lines[i]
      if (cur.startsWith('author ') && !cur.startsWith('author-')) author = cur.slice(7)
      else if (cur.startsWith('author-time ')) timestamp = parseInt(cur.slice(12), 10)
      else if (cur.startsWith('summary ')) summary = cur.slice(8)
      i++
    }
    if (lines[i]?.startsWith('\t')) i++
    if (author) entries.push({ line: lineNum, sha, author, timestamp, summary })
  }
  return entries
}

export function registerGitHandlers(): void {
  ipcMain.handle('git:branch', async (_, cwd: string) => {
    try {
      return await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    } catch {
      return null
    }
  })

  ipcMain.handle('git:status', async (_, cwd: string) => {
    try {
      const out = await git(cwd, ['status', '--porcelain'])
      const lines = out.split('\n').filter(Boolean)
      const modified  = lines.filter(l => l.startsWith(' M') || l.startsWith('MM') || l.startsWith('M ')).length
      const added     = lines.filter(l => l.startsWith('A ') || l.startsWith('??')).length
      const deleted   = lines.filter(l => l.startsWith(' D') || l.startsWith('D ')).length
      return { modified, added, deleted, total: lines.length, clean: lines.length === 0 }
    } catch {
      return null
    }
  })

  ipcMain.handle('git:log', async (_, cwd: string) => {
    try {
      const out = await git(cwd, ['log', '--oneline', '-10'])
      return out.split('\n').filter(Boolean).map(line => {
        const [hash, ...rest] = line.split(' ')
        return { hash, message: rest.join(' ') }
      })
    } catch {
      return []
    }
  })

  ipcMain.handle('git:add', async (_, { cwd, paths }: { cwd: string; paths: string[] }) => {
    try {
      await git(cwd, ['add', ...paths])
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('git:commit', async (_, { cwd, message }: { cwd: string; message: string }) => {
    try {
      await git(cwd, ['commit', '-m', message])
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('git:diff', async (_, { cwd, path: filePath }: { cwd: string; path: string }) => {
    try {
      return await git(cwd, ['diff', 'HEAD', '--', filePath])
    } catch {
      return ''
    }
  })

  ipcMain.handle('git:statusFiles', async (_, cwd: string) => {
    try {
      const out = await git(cwd, ['status', '--porcelain'])
      return out.split('\n').filter(Boolean).map(line => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle('git:pull', async (_, { cwd, remote = 'origin', branch }: { cwd: string; remote?: string; branch?: string }) => {
    try {
      const args = ['pull', remote]
      if (branch) args.push(branch)
      const out = await git(cwd, args, 60_000)
      return { success: true, output: out }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('git:createBranch', async (_, { cwd, branch, checkout = true }: { cwd: string; branch: string; checkout?: boolean }) => {
    try {
      if (checkout) {
        await git(cwd, ['checkout', '-b', branch])
      } else {
        await git(cwd, ['branch', branch])
      }
      return { success: true, branch }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('git:checkoutBranch', async (_, { cwd, branch }: { cwd: string; branch: string }) => {
    try {
      await git(cwd, ['checkout', branch])
      return { success: true, branch }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('git:listBranches', async (_, cwd: string) => {
    try {
      const out = await git(cwd, ['branch', '--list'])
      const branches = out.split('\n').filter(Boolean).map(l => l.replace(/^\*?\s+/, '').trim())
      const current = branches.find(b => out.includes(`* ${b}`)) ?? branches[0] ?? null
      return { branches, current }
    } catch {
      return { branches: [], current: null }
    }
  })

  ipcMain.handle('git:blame', async (_, { cwd, filePath }: { cwd: string; filePath: string }): Promise<BlameEntry[]> => {
    try {
      const out = await git(cwd, ['blame', '--porcelain', filePath], 15_000)
      return parsePorcelain(out)
    } catch {
      return []
    }
  })
}
