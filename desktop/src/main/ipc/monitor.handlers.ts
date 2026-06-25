import { ipcMain } from 'electron'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { store } from '../store'
import { repoRoot } from '../paths'
import { appendAlert, listAlerts, clearAlerts, type AlertRecord } from '../monitorAlertLog'

// node-pty is loaded lazily via dynamic import() to avoid CJS/ESM interop issues
// — same pattern as terminal.handlers.ts, which this module otherwise mirrors
// closely (spawn/onData/onExit/cleanup), but spawns a fixed command via
// `/bin/sh -c <cmd>` instead of an interactive shell.
type PtyModule = typeof import('node-pty')
let ptyPromise: Promise<PtyModule | null> | null = null

async function getPty(): Promise<PtyModule | null> {
  if (ptyPromise) return ptyPromise
  ptyPromise = import('node-pty').catch((e) => {
    console.warn('node-pty unavailable — monitor disabled:', e.message)
    return null
  })
  return ptyPromise
}

const monitors = new Map<string, import('node-pty').IPty>()
// node-pty delivers arbitrary byte chunks, not line-delimited text — alert
// detection needs discrete lines, so each active monitor buffers its
// trailing partial line across onData calls.
const lineBuffers = new Map<string, string>()

const ERROR_PATTERN = /\b(error|exception|fail(?:ed|ure)?|fatal|panic|5\d\d)\b/i

function projectRoot(): string {
  return path.resolve((store.get('projectPath') as string | undefined) || repoRoot())
}

export function registerMonitorHandlers(): void {
  ipcMain.handle('monitor:start', async (event, cmd: string, cwd?: string): Promise<{ id?: string; error?: string }> => {
    const pty = await getPty()
    if (!pty) return { error: 'node-pty not available (rebuild native modules)' }
    if (!cmd.trim()) return { error: 'No command given' }

    const id = randomUUID()
    const resolvedCwd = cwd || projectRoot()

    let term: import('node-pty').IPty
    try {
      term = pty.spawn('/bin/sh', ['-c', cmd], { name: 'xterm-256color', cols: 120, rows: 30, cwd: resolvedCwd })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }

    lineBuffers.set(id, '')

    term.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`monitor:data:${id}`, data)
      }
      const buffered = (lineBuffers.get(id) ?? '') + data
      const lines = buffered.split('\n')
      lineBuffers.set(id, lines.pop() ?? '')
      for (const line of lines) {
        if (ERROR_PATTERN.test(line)) {
          const alert = appendAlert(projectRoot(), line, id)
          if (alert && !event.sender.isDestroyed()) {
            event.sender.send(`monitor:alert:${id}`, alert)
          }
        }
      }
    })

    let terminated = false
    const cleanup = () => {
      if (terminated) return
      terminated = true
      try { term.kill() } catch { /* already dead */ }
      monitors.delete(id)
      lineBuffers.delete(id)
    }

    term.onExit(({ exitCode }) => {
      cleanup()
      if (!event.sender.isDestroyed()) {
        event.sender.send(`monitor:exit:${id}`, exitCode)
      }
    })

    event.sender.on('destroyed', cleanup)

    monitors.set(id, term)
    return { id }
  })

  ipcMain.handle('monitor:stop', (_, id: string) => {
    try { monitors.get(id)?.kill() } catch { /* ignore */ }
    monitors.delete(id)
    lineBuffers.delete(id)
  })

  ipcMain.handle('monitor:listAlerts', (): AlertRecord[] => {
    return listAlerts(projectRoot())
  })

  ipcMain.handle('monitor:clearAlerts', (): void => {
    clearAlerts(projectRoot())
  })
}
