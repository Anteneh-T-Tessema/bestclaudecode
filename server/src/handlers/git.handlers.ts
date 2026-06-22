import type { HandlerRegistry } from '../router.js'

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

function gitCommand(args: string[]): string {
  return ['git', ...args.map(shellQuote)].join(' ')
}

interface GitStatus {
  modified: number
  added: number
  deleted: number
  total: number
  clean: boolean
}

interface GitLogEntry {
  hash: string
  message: string
}

interface GitFileStatus {
  status: string
  path: string
}

interface GitOpResult {
  success: boolean
  error?: string
  branch?: string
  output?: string
}

const GIT_TIMEOUT_MS = 30_000
const GIT_PULL_TIMEOUT_MS = 60_000

// Faithful port of desktop/src/main/ipc/git.handlers.ts — same channel names
// and payload shapes. The only structural difference: execFile throws on a
// non-zero exit so the original used try/catch; adapter.runCommand never
// throws, so each handler here checks exitCode explicitly instead.
export function registerGitHandlers(registry: HandlerRegistry): void {
  registry.register('git:branch', async (adapter, payload) => {
    const cwd = payload as string
    const result = await adapter.runCommand(gitCommand(['rev-parse', '--abbrev-ref', 'HEAD']), cwd, GIT_TIMEOUT_MS)
    return result.exitCode === 0 ? result.stdout.trim() : null
  })

  registry.register('git:status', async (adapter, payload): Promise<GitStatus | null> => {
    const cwd = payload as string
    const result = await adapter.runCommand(gitCommand(['status', '--porcelain']), cwd, GIT_TIMEOUT_MS)
    if (result.exitCode !== 0) return null
    const lines = result.stdout.trim().split('\n').filter(Boolean)
    const modified = lines.filter((l) => l.startsWith(' M') || l.startsWith('MM') || l.startsWith('M ')).length
    const added = lines.filter((l) => l.startsWith('A ') || l.startsWith('??')).length
    const deleted = lines.filter((l) => l.startsWith(' D') || l.startsWith('D ')).length
    return { modified, added, deleted, total: lines.length, clean: lines.length === 0 }
  })

  registry.register('git:log', async (adapter, payload): Promise<GitLogEntry[]> => {
    const cwd = payload as string
    const result = await adapter.runCommand(gitCommand(['log', '--oneline', '-10']), cwd, GIT_TIMEOUT_MS)
    if (result.exitCode !== 0) return []
    return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, ...rest] = line.split(' ')
      return { hash, message: rest.join(' ') }
    })
  })

  registry.register('git:add', async (adapter, payload): Promise<GitOpResult> => {
    const { cwd, paths } = payload as { cwd: string; paths: string[] }
    const result = await adapter.runCommand(gitCommand(['add', ...paths]), cwd, GIT_TIMEOUT_MS)
    return result.exitCode === 0 ? { success: true } : { success: false, error: result.stderr.trim() }
  })

  registry.register('git:commit', async (adapter, payload): Promise<GitOpResult> => {
    const { cwd, message } = payload as { cwd: string; message: string }
    const result = await adapter.runCommand(gitCommand(['commit', '-m', message]), cwd, GIT_TIMEOUT_MS)
    return result.exitCode === 0 ? { success: true } : { success: false, error: result.stderr.trim() }
  })

  registry.register('git:diff', async (adapter, payload): Promise<string> => {
    const { cwd, path: filePath } = payload as { cwd: string; path: string }
    const result = await adapter.runCommand(gitCommand(['diff', 'HEAD', '--', filePath]), cwd, GIT_TIMEOUT_MS)
    return result.exitCode === 0 ? result.stdout : ''
  })

  registry.register('git:statusFiles', async (adapter, payload): Promise<GitFileStatus[]> => {
    const cwd = payload as string
    const result = await adapter.runCommand(gitCommand(['status', '--porcelain']), cwd, GIT_TIMEOUT_MS)
    if (result.exitCode !== 0) return []
    return result.stdout.trim().split('\n').filter(Boolean).map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    }))
  })

  registry.register('git:pull', async (adapter, payload): Promise<GitOpResult> => {
    const { cwd, remote = 'origin', branch } = payload as { cwd: string; remote?: string; branch?: string }
    const args = ['pull', remote]
    if (branch) args.push(branch)
    const result = await adapter.runCommand(gitCommand(args), cwd, GIT_PULL_TIMEOUT_MS)
    return result.exitCode === 0
      ? { success: true, output: result.stdout.trim() }
      : { success: false, error: result.stderr.trim() }
  })

  registry.register('git:createBranch', async (adapter, payload): Promise<GitOpResult> => {
    const { cwd, branch, checkout = true } = payload as { cwd: string; branch: string; checkout?: boolean }
    const args = checkout ? ['checkout', '-b', branch] : ['branch', branch]
    const result = await adapter.runCommand(gitCommand(args), cwd, GIT_TIMEOUT_MS)
    return result.exitCode === 0 ? { success: true, branch } : { success: false, error: result.stderr.trim() }
  })

  registry.register('git:checkoutBranch', async (adapter, payload): Promise<GitOpResult> => {
    const { cwd, branch } = payload as { cwd: string; branch: string }
    const result = await adapter.runCommand(gitCommand(['checkout', branch]), cwd, GIT_TIMEOUT_MS)
    return result.exitCode === 0 ? { success: true, branch } : { success: false, error: result.stderr.trim() }
  })

  registry.register('git:listBranches', async (adapter, payload): Promise<{ branches: string[]; current: string | null }> => {
    const cwd = payload as string
    const result = await adapter.runCommand(gitCommand(['branch', '--list']), cwd, GIT_TIMEOUT_MS)
    if (result.exitCode !== 0) return { branches: [], current: null }
    const out = result.stdout.trim()
    const branches = out.split('\n').filter(Boolean).map((l) => l.replace(/^\*?\s+/, '').trim())
    const current = branches.find((b) => out.includes(`* ${b}`)) ?? branches[0] ?? null
    return { branches, current }
  })
}
