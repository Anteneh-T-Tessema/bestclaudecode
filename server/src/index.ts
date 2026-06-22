import { WebSocketServer } from 'ws'
import { randomUUID } from 'node:crypto'
import { HandlerRegistry, attachSession } from './router.js'
import { SandboxManager } from './sandbox/manager.js'
import { registerFsHandlers } from './handlers/fs.handlers.js'
import { registerTerminalHandlers } from './handlers/terminal.handlers.js'
import { registerGitHandlers } from './handlers/git.handlers.js'
import { registerLspHandlers } from './handlers/lsp.handlers.js'
import { registerAiHandlers } from './handlers/ai.handlers.js'
import { registerSettingsHandlers } from './handlers/settings.handlers.js'
import { registerSearchHandlers } from './handlers/search.handlers.js'
import { registerDapHandlers } from './handlers/dap.handlers.js'

const PORT = Number(process.env.PORT ?? 8787)

const registry = new HandlerRegistry()
registerFsHandlers(registry)
registerTerminalHandlers(registry)
registerGitHandlers(registry)
registerLspHandlers(registry)
registerAiHandlers(registry)
registerSettingsHandlers(registry)
registerSearchHandlers(registry)
registerDapHandlers(registry)

const sandboxManager = new SandboxManager()

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
  const sessionId = randomUUID()
  void (async () => {
    try {
      const adapter = await sandboxManager.getOrCreate(sessionId)
      attachSession(ws, registry, adapter, sessionId)
      ws.on('close', () => {
        registry.cleanupSession(sessionId)
        void sandboxManager.destroy(sessionId)
      })
    } catch (err) {
      ws.send(JSON.stringify({
        channel: 'session:error',
        event: true,
        payload: { error: err instanceof Error ? err.message : String(err) },
      }))
      ws.close()
    }
  })()
})

console.error(`lakoora-server listening on ws://localhost:${PORT}`)

process.on('SIGINT', () => {
  void sandboxManager.destroyAll().then(() => process.exit(0))
})
