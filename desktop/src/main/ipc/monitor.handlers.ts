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
// Race fix: for a near-instant command (e.g. `echo`), the pty can spawn, run,
// and emit all its output via onData before the renderer's React effect
// (which only subscribes monitor:data:<id> *after* monitor:start's IPC
// round-trip resolves and triggers a re-render) has registered its
// listener — Electron IPC doesn't buffer past sends for a not-yet-subscribed
// channel, so that output is silently lost. Mirrors the backlog-then-live
// pattern webhookServer.ts's /watch-stream already uses for the same reason:
// every chunk is also accumulated here (capped) so a late subscriber can
// fetch what it missed via monitor:getBacklog before going live.
const rawBuffers = new Map<string, string>()
const MAX_BACKLOG = 64 * 1024
// Same race, same fix, for exit: a near-instant command can run term.onExit
// (and event.sender.send the exit code) before the renderer has subscribed
// monitor:exit:<id> — observed in CI as the Stop button never reverting to
// Start because the exit notification was sent into the void. Recorded here
// so a late subscriber can ask "did it already exit?" via monitor:getBacklog.
const exitedCodes = new Map<string, number>()

export const ERROR_PATTERN = /\b(error|exception|fail(?:ed|ure)?|fatal|panic|5\d\d)\b/i

/**
 * node-pty delivers arbitrary byte chunks, not line-delimited text. Given the
 * buffered trailing partial line from the previous call plus a new chunk,
 * returns the complete lines found and the new trailing partial to carry
 * forward. Pulled out of the onData closure below so it's unit-testable
 * without spawning a real pty.
 */
export function splitLines(buffer: string, chunk: string): { lines: string[]; remainder: string } {
  const combined = buffer + chunk
  const lines = combined.split('\n')
  const remainder = lines.pop() ?? ''
  return { lines, remainder }
}

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
    rawBuffers.set(id, '')

    term.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`monitor:data:${id}`, data)
      }
      const combined = (rawBuffers.get(id) ?? '') + data
      rawBuffers.set(id, combined.length > MAX_BACKLOG ? combined.slice(-MAX_BACKLOG) : combined)
      const { lines, remainder } = splitLines(lineBuffers.get(id) ?? '', data)
      lineBuffers.set(id, remainder)
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
      exitedCodes.set(id, exitCode)
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
    rawBuffers.delete(id)
    exitedCodes.delete(id)
  })

  // Race fix companion — fetched once by the renderer right after monitor:start
  // resolves, *before* it subscribes monitor:data:<id>/monitor:exit:<id> for
  // live updates, so anything the pty already emitted/finished in that window
  // isn't lost. Deliberately not cleared on process exit (only on
  // monitor:stop / explicit cleanup of the id) since a near-instant command's
  // data or exit can itself race ahead of the renderer fetching this.
  ipcMain.handle('monitor:getBacklog', (_, id: string): { data: string; exitCode: number | null } => {
    return {
      data: rawBuffers.get(id) ?? '',
      exitCode: exitedCodes.has(id) ? exitedCodes.get(id)! : null,
    }
  })

  ipcMain.handle('monitor:listAlerts', (): AlertRecord[] => {
    return listAlerts(projectRoot())
  })

  ipcMain.handle('monitor:clearAlerts', (): void => {
    clearAlerts(projectRoot())
  })
}
