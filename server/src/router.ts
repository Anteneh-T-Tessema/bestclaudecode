import type { WebSocket } from 'ws'
import type { SandboxAdapter } from './sandbox/types.js'

export interface HandlerContext {
  sessionId: string
  send(channel: string, payload: unknown): void
}

export type Handler = (adapter: SandboxAdapter, payload: unknown, ctx: HandlerContext) => Promise<unknown>

interface RequestMessage {
  id: string
  channel: string
  payload: unknown
}

export interface ResponseMessage {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

// Every ported Electron IPC handler (fs:*, terminal:*, lsp:*, ...) registers
// here under the same channel name it used as an ipcMain.handle() channel —
// this is the seam that let ~80% of desktop/src/main/ipc/*.handlers.ts move
// over with only the transport changed, not the logic.
export class HandlerRegistry {
  private readonly handlers = new Map<string, Handler>()
  private readonly cleanupFns: Array<(sessionId: string) => void> = []

  register(channel: string, handler: Handler): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Handler for channel "${channel}" already registered`)
    }
    this.handlers.set(channel, handler)
  }

  get(channel: string): Handler | undefined {
    return this.handlers.get(channel)
  }

  // Handler modules that keep per-session in-memory state (e.g. open
  // terminals keyed by session) register a cleanup callback here instead of
  // index.ts knowing about every module's internals.
  registerCleanup(fn: (sessionId: string) => void): void {
    this.cleanupFns.push(fn)
  }

  cleanupSession(sessionId: string): void {
    for (const fn of this.cleanupFns) fn(sessionId)
  }
}

export async function dispatch(
  registry: HandlerRegistry,
  adapter: SandboxAdapter,
  ctx: HandlerContext,
  raw: string,
): Promise<ResponseMessage | null> {
  let message: RequestMessage
  try {
    message = JSON.parse(raw) as RequestMessage
  } catch {
    return null
  }
  const handler = registry.get(message.channel)
  if (!handler) {
    return { id: message.id, ok: false, error: `No handler registered for channel "${message.channel}"` }
  }
  try {
    const result = await handler(adapter, message.payload, ctx)
    return { id: message.id, ok: true, result }
  } catch (err) {
    return { id: message.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function attachSession(
  ws: WebSocket,
  registry: HandlerRegistry,
  adapter: SandboxAdapter,
  sessionId: string,
): void {
  const ctx: HandlerContext = {
    sessionId,
    send: (channel, payload) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ channel, event: true, payload }))
      }
    },
  }
  ws.on('message', async (data: Buffer) => {
    const response = await dispatch(registry, adapter, ctx, data.toString())
    if (response && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(response))
    }
  })
}
