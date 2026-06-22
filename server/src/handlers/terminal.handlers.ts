import { randomUUID } from 'node:crypto'
import type { HandlerRegistry } from '../router.js'
import type { TerminalHandle } from '../sandbox/types.js'

// Mirrored from desktop/src/main/ipc/settings.handlers.ts's MAIN_BLOCKED and
// mcp-servers/build-log-server's BLOCKED_PATTERNS — kept in sync across all
// three surfaces since they enforce the same safety policy.
const BLOCKED_PATTERNS = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(\/|~|\$HOME|\$\{HOME\})/i,
  /:\(\)\s*\{\s*:|:\s*&\s*\}/,
  /dd\s+if=\/dev\/zero\s+of=\/dev\//i,
  /\bmkfs\b/i,
]

const terminalsBySession = new Map<string, Map<string, TerminalHandle>>()

function sessionTerminals(sessionId: string): Map<string, TerminalHandle> {
  let map = terminalsBySession.get(sessionId)
  if (!map) {
    map = new Map()
    terminalsBySession.set(sessionId, map)
  }
  return map
}

// Mirrors desktop/src/main/ipc/terminal.handlers.ts's channel names and
// payload shapes exactly. The PTY itself now lives in the sandbox (real
// node-pty locally is replaced by adapter.createTerminal — a true PTY via
// E2B's native Pty module in production, a plain shell pipe in local dev).
export function registerTerminalHandlers(registry: HandlerRegistry): void {
  registry.register('terminal:create', async (adapter, payload, ctx) => {
    const { cwd, cols, rows } = payload as { cwd?: string; cols?: number; rows?: number }
    const id = randomUUID()
    try {
      const handle = await adapter.createTerminal({
        cwd,
        cols: cols ?? 80,
        rows: rows ?? 24,
        onData: (chunk) => ctx.send(`terminal:data:${id}`, chunk),
        onExit: (exitCode) => {
          sessionTerminals(ctx.sessionId).delete(id)
          ctx.send(`terminal:exit:${id}`, exitCode)
        },
      })
      sessionTerminals(ctx.sessionId).set(id, handle)
      return { id }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  registry.register('terminal:write', async (_adapter, payload, ctx) => {
    const { id, data } = payload as { id: string; data: string }
    await sessionTerminals(ctx.sessionId).get(id)?.write(data)
  })

  registry.register('terminal:resize', async (_adapter, payload, ctx) => {
    const { id, cols, rows } = payload as { id: string; cols: number; rows: number }
    try {
      await sessionTerminals(ctx.sessionId).get(id)?.resize(cols, rows)
    } catch { /* ignore — mirrors the Electron handler's best-effort resize */ }
  })

  registry.register('terminal:kill', async (_adapter, payload, ctx) => {
    const { id } = payload as { id: string }
    try {
      await sessionTerminals(ctx.sessionId).get(id)?.kill()
    } catch { /* already dead */ }
    sessionTerminals(ctx.sessionId).delete(id)
  })

  registry.register('terminal:runCommand', async (adapter, payload) => {
    const { command, cwd } = payload as { command: string; cwd?: string }
    if (BLOCKED_PATTERNS.some((re) => re.test(command))) {
      throw new Error('Command blocked by Lakoora safety policy')
    }
    return adapter.runCommand(command, cwd)
  })

  registry.registerCleanup((sessionId) => {
    const map = terminalsBySession.get(sessionId)
    if (map) {
      // Must actually kill each handle, not just drop the JS reference —
      // these are real child processes (or remote PTYs) that otherwise leak
      // and, locally, keep the Node event loop alive indefinitely.
      for (const handle of map.values()) {
        void handle.kill().catch(() => { /* already dead */ })
      }
    }
    terminalsBySession.delete(sessionId)
  })
}
