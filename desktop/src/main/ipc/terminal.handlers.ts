import { ipcMain } from 'electron'
import * as os from 'os'
import * as fs from 'fs'
import { randomUUID } from 'crypto'

// node-pty is loaded lazily via dynamic import() to avoid CJS/ESM interop issues
type PtyModule = typeof import('node-pty')
let ptyPromise: Promise<PtyModule | null> | null = null

async function getPty(): Promise<PtyModule | null> {
  if (ptyPromise) return ptyPromise
  ptyPromise = import('node-pty').catch((e) => {
    console.warn('node-pty unavailable — terminal disabled:', e.message)
    return null
  })
  return ptyPromise
}

const terminals = new Map<string, import('node-pty').IPty>()

function pathIsDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

function resolveTerminalShellCandidates(): string[] {
  if (process.platform === 'win32') return ['powershell.exe', 'cmd.exe']

  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter((candidate): candidate is string => !!candidate)

  return Array.from(new Set(candidates)).filter((candidate) => fs.existsSync(candidate))
}

function terminalEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  env.TERM = env.TERM || 'xterm-256color'
  env.COLORTERM = env.COLORTERM || 'truecolor'
  return env
}

export function registerTerminalHandlers(): void {
  ipcMain.handle('terminal:create', async (event, { cwd, cols, rows }: { cwd?: string; cols?: number; rows?: number }) => {
    const pty = await getPty()
    if (!pty) return { error: 'node-pty not available (rebuild native modules)' }

    const id = randomUUID()
    const shellCandidates = resolveTerminalShellCandidates()
    const resolvedCwd = cwd && pathIsDirectory(cwd) ? cwd : os.homedir()

    let term: import('node-pty').IPty | null = null
    let lastError = 'no shell candidates were found'
    for (const shell of shellCandidates) {
      try {
        term = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: cols ?? 80,
          rows: rows ?? 24,
          cwd: resolvedCwd,
          env: terminalEnv()
        })
        break
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    if (!term) {
      const tried = shellCandidates.length > 0 ? shellCandidates.join(', ') : 'none'
      return { error: `Unable to start terminal shell. Tried: ${tried}. ${lastError}` }
    }

    term.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`terminal:data:${id}`, data)
      }
    })

    // Shared flag prevents double-kill and double-delete when onExit and
    // the 'destroyed' event fire concurrently (race condition in node-pty).
    let terminated = false
    const cleanup = () => {
      if (terminated) return
      terminated = true
      try { term!.kill() } catch { /* already dead */ }
      terminals.delete(id)
    }

    term.onExit(({ exitCode }) => {
      cleanup()
      if (!event.sender.isDestroyed()) {
        event.sender.send(`terminal:exit:${id}`, exitCode)
      }
    })

    event.sender.on('destroyed', cleanup)

    terminals.set(id, term)
    return { id }
  })

  ipcMain.handle('terminal:write', (_, { id, data }: { id: string; data: string }) => {
    terminals.get(id)?.write(data)
  })

  ipcMain.handle('terminal:resize', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    try {
      terminals.get(id)?.resize(cols, rows)
    } catch { /* ignore */ }
  })

  ipcMain.handle('terminal:kill', (_, id: string) => {
    try { terminals.get(id)?.kill() } catch { /* ignore */ }
    terminals.delete(id)
  })
}
