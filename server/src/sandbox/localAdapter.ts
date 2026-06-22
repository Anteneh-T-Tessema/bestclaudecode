import { mkdir, readFile as fsReadFile, writeFile as fsWriteFile, readdir, rm, rename as fsRename, access } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  SandboxAdapter, CommandResult, DirEntry, TerminalOptions, TerminalHandle, ProcessOptions, ProcessHandle,
} from './types.js'

function resolveInRoot(root: string, target: string): string {
  const relative = target.startsWith('/') ? target.slice(1) : target
  const resolved = path.resolve(root, relative)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Access denied: path "${target}" resolves outside sandbox root`)
  }
  return resolved
}

// Dev-only fallback adapter — runs everything as real local processes/files
// scoped under `root`, so the router/handler layer can be built and tested
// without an E2B API key. Production sessions use E2bSandboxAdapter instead.
export class LocalSandboxAdapter implements SandboxAdapter {
  readonly id: string
  private readonly root: string
  // Long-running children (terminals, spawned processes) are separate OS
  // processes from this Node server — unlike E2bSandboxAdapter, killing this
  // adapter does not kill them for free, so destroy() must track and reap them.
  private readonly children = new Set<ChildProcess>()

  constructor(root: string) {
    this.id = randomUUID()
    this.root = path.resolve(root)
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = resolveInRoot(this.root, filePath)
    await mkdir(path.dirname(resolved), { recursive: true })
    await fsWriteFile(resolved, content, 'utf-8')
  }

  async readFile(filePath: string): Promise<string> {
    return fsReadFile(resolveInRoot(this.root, filePath), 'utf-8')
  }

  async readDir(dirPath: string): Promise<DirEntry[]> {
    const resolved = resolveInRoot(this.root, dirPath)
    const entries = await readdir(resolved, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      path: path.posix.join(dirPath, e.name),
      isDirectory: e.isDirectory(),
    }))
  }

  async makeDir(dirPath: string): Promise<void> {
    await mkdir(resolveInRoot(this.root, dirPath), { recursive: true })
  }

  async deleteEntry(targetPath: string): Promise<void> {
    await rm(resolveInRoot(this.root, targetPath), { recursive: true, force: true })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fsRename(resolveInRoot(this.root, oldPath), resolveInRoot(this.root, newPath))
  }

  async exists(targetPath: string): Promise<boolean> {
    try {
      await access(resolveInRoot(this.root, targetPath))
      return true
    } catch {
      return false
    }
  }

  runCommand(command: string, cwd?: string, timeoutMs?: number): Promise<CommandResult> {
    return new Promise((resolve) => {
      const proc = spawn('/bin/sh', ['-c', command], {
        cwd: cwd ? resolveInRoot(this.root, cwd) : this.root,
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = timeoutMs
        ? setTimeout(() => { timedOut = true; proc.kill() }, timeoutMs)
        : undefined
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.on('close', (code) => {
        if (timer) clearTimeout(timer)
        resolve({
          stdout,
          stderr: timedOut ? `${stderr}\n[command timed out after ${timeoutMs}ms]` : stderr,
          exitCode: timedOut ? 124 : (code ?? 1),
        })
      })
      proc.on('error', (err) => {
        if (timer) clearTimeout(timer)
        resolve({ stdout: '', stderr: err.message, exitCode: 1 })
      })
    })
  }

  // Not a true PTY (no ANSI/cursor-control emulation) — fine for local dev.
  // Production terminal fidelity comes from E2bSandboxAdapter's native Pty module.
  async createTerminal(opts: TerminalOptions): Promise<TerminalHandle> {
    const shell = process.env.SHELL ?? '/bin/sh'
    const proc = spawn(shell, [], {
      cwd: opts.cwd ? resolveInRoot(this.root, opts.cwd) : this.root,
      env: process.env,
    })
    this.children.add(proc)
    proc.stdout.on('data', (d: Buffer) => opts.onData(d.toString()))
    proc.stderr.on('data', (d: Buffer) => opts.onData(d.toString()))
    proc.on('exit', (code) => {
      this.children.delete(proc)
      opts.onExit?.(code ?? undefined)
    })
    return {
      pid: proc.pid ?? -1,
      write: async (data: string) => { proc.stdin.write(data) },
      resize: async () => { /* no-op: not a real PTY locally */ },
      kill: async () => { proc.kill() },
    }
  }

  async spawnProcess(command: string, args: string[], opts: ProcessOptions): Promise<ProcessHandle> {
    const proc = spawn(command, args, {
      cwd: opts.cwd ? resolveInRoot(this.root, opts.cwd) : this.root,
    })
    this.children.add(proc)
    proc.stdout.on('data', (d: Buffer) => opts.onStdout(d.toString()))
    proc.stderr.on('data', (d: Buffer) => opts.onStderr(d.toString()))
    proc.on('exit', (code) => {
      this.children.delete(proc)
      opts.onExit?.(code ?? 1)
    })
    // Without an error handler, a spawn failure (ENOENT) becomes an uncaught
    // process-level exception. Route it through onExit so callers see it as a
    // graceful termination rather than a crash.
    proc.on('error', (err) => {
      this.children.delete(proc)
      opts.onStderr(err.message)
      opts.onExit?.(1)
    })
    return {
      pid: proc.pid ?? -1,
      writeStdin: async (data: string) => { proc.stdin?.write(data) },
      kill: async () => { proc.kill() },
    }
  }

  async destroy(): Promise<void> {
    for (const child of this.children) {
      try { child.kill() } catch { /* already dead */ }
    }
    this.children.clear()
  }
}
