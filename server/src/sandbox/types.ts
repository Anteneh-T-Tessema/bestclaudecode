export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface TerminalOptions {
  cwd?: string
  cols: number
  rows: number
  onData: (chunk: string) => void
  onExit?: (exitCode?: number) => void
}

export interface TerminalHandle {
  pid: number
  write(data: string): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  kill(): Promise<void>
}

export interface ProcessOptions {
  cwd?: string
  onStdout: (chunk: string) => void
  onStderr: (chunk: string) => void
  onExit?: (exitCode: number) => void
}

export interface ProcessHandle {
  pid: number
  writeStdin(data: string): Promise<void>
  kill(): Promise<void>
}

// One adapter instance backs one user session's workspace — either a local
// directory (dev) or a remote E2B sandbox (production). Every handler in
// server/src/handlers/ talks to this interface only, never to fs/child_process
// or the e2b SDK directly, so swapping backends never touches handler code.
export interface SandboxAdapter {
  readonly id: string
  writeFile(path: string, content: string): Promise<void>
  readFile(path: string): Promise<string>
  readDir(path: string): Promise<DirEntry[]>
  makeDir(path: string): Promise<void>
  deleteEntry(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  exists(path: string): Promise<boolean>
  runCommand(command: string, cwd?: string, timeoutMs?: number): Promise<CommandResult>
  createTerminal(opts: TerminalOptions): Promise<TerminalHandle>
  spawnProcess(command: string, args: string[], opts: ProcessOptions): Promise<ProcessHandle>
  destroy(): Promise<void>
}
