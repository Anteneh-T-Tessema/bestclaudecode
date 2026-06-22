import { Sandbox, FileType } from 'e2b'
import type {
  SandboxAdapter, CommandResult, DirEntry, TerminalOptions, TerminalHandle, ProcessOptions, ProcessHandle,
} from './types.js'

export interface E2bCreateOptions {
  templateId?: string
  apiKey?: string
  timeoutMs?: number
}

// Production adapter — backs one user session with a real E2B Firecracker
// microVM. API surface verified against e2b@2.30.4's shipped type
// declarations (Sandbox.files / .commands / .pty), not assumed from docs.
export class E2bSandboxAdapter implements SandboxAdapter {
  readonly id: string

  private constructor(private readonly sandbox: Sandbox) {
    this.id = sandbox.sandboxId
  }

  static async create(opts: E2bCreateOptions = {}): Promise<E2bSandboxAdapter> {
    const sandbox = opts.templateId
      ? await Sandbox.create(opts.templateId, { apiKey: opts.apiKey, timeoutMs: opts.timeoutMs })
      : await Sandbox.create({ apiKey: opts.apiKey, timeoutMs: opts.timeoutMs })
    return new E2bSandboxAdapter(sandbox)
  }

  // Re-attach to an already-running sandbox (e.g. after a server restart) —
  // this is what makes multi-hour autonomous-agent sessions survive a
  // disconnect, per Phase 5 of the roadmap.
  static async resume(sandboxId: string, apiKey?: string): Promise<E2bSandboxAdapter> {
    const sandbox = await Sandbox.connect(sandboxId, { apiKey })
    return new E2bSandboxAdapter(sandbox)
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.sandbox.files.write(filePath, content)
  }

  readFile(filePath: string): Promise<string> {
    return this.sandbox.files.read(filePath)
  }

  async readDir(dirPath: string): Promise<DirEntry[]> {
    const entries = await this.sandbox.files.list(dirPath)
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.type === FileType.DIR,
    }))
  }

  async makeDir(dirPath: string): Promise<void> {
    await this.sandbox.files.makeDir(dirPath)
  }

  async deleteEntry(targetPath: string): Promise<void> {
    await this.sandbox.files.remove(targetPath)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.sandbox.files.rename(oldPath, newPath)
  }

  exists(targetPath: string): Promise<boolean> {
    return this.sandbox.files.exists(targetPath)
  }

  async runCommand(command: string, cwd?: string, timeoutMs?: number): Promise<CommandResult> {
    const result = await this.sandbox.commands.run(command, { cwd, timeoutMs })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
  }

  async createTerminal(opts: TerminalOptions): Promise<TerminalHandle> {
    const { pty } = this.sandbox
    const handle = await pty.create({
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      onData: (data: Uint8Array) => opts.onData(Buffer.from(data).toString('utf-8')),
    })
    void handle.wait()
      .then((result) => opts.onExit?.(result.exitCode))
      .catch(() => opts.onExit?.(undefined))
    return {
      pid: handle.pid,
      write: async (data: string) => { await pty.sendInput(handle.pid, new TextEncoder().encode(data)) },
      resize: async (cols: number, rows: number) => { await pty.resize(handle.pid, { cols, rows }) },
      kill: async () => { await pty.kill(handle.pid) },
    }
  }

  async spawnProcess(command: string, args: string[], opts: ProcessOptions): Promise<ProcessHandle> {
    const full = [command, ...args].join(' ')
    const handle = await this.sandbox.commands.run(full, {
      background: true,
      cwd: opts.cwd,
      stdin: true,
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
    })
    void handle.wait()
      .then((result) => opts.onExit?.(result.exitCode))
      .catch((err: { exitCode?: number }) => opts.onExit?.(err?.exitCode ?? 1))
    return {
      pid: handle.pid,
      writeStdin: async (data: string) => { await handle.sendStdin(data) },
      kill: async () => { await handle.kill() },
    }
  }

  async destroy(): Promise<void> {
    await this.sandbox.kill()
  }
}
