import type { HandlerRegistry, HandlerContext } from '../router.js'
import type { SandboxAdapter } from '../sandbox/types.js'
import { DapClient } from '../dap/dapClient.js'
import { DEBUG_ADAPTERS, type DebugLang } from '../dap/config.js'

// One DapClient per session. A session can run at most one debug target at
// a time — starting a new launch disconnects the previous one automatically.
const clientsBySession = new Map<string, DapClient>()

function bindEvents(client: DapClient, ctx: HandlerContext): void {
  // Forward all debugger push events as WebSocket/IPC session events so the
  // renderer can react without polling. The channel names mirror VS Code's
  // DAP event names, prefixed with 'dap:'.
  client.on('stopped', (body: unknown) => ctx.send('dap:stopped', body))
  client.on('continued', (body: unknown) => ctx.send('dap:continued', body))
  client.on('terminated', (body: unknown) => ctx.send('dap:terminated', body))
  client.on('output', (body: unknown) => ctx.send('dap:output', body))
  client.on('thread', (body: unknown) => ctx.send('dap:thread', body))
  client.on('breakpoint', (body: unknown) => ctx.send('dap:breakpoint', body))
}

function getOrCreateClient(adapter: SandboxAdapter, ctx: HandlerContext): DapClient {
  const existing = clientsBySession.get(ctx.sessionId)
  if (existing?.isRunning) return existing

  // Reuse the config for the current language — resolved later at launch time
  // by creating a fresh client with the right adapter command.
  const python = DEBUG_ADAPTERS.python
  const client = new DapClient(adapter, python.command, python.args)
  bindEvents(client, ctx)
  clientsBySession.set(ctx.sessionId, client)
  return client
}

function getLangAdapter(lang: DebugLang) {
  return DEBUG_ADAPTERS[lang] ?? DEBUG_ADAPTERS.python
}

export function registerDapHandlers(registry: HandlerRegistry): void {
  // dap:launch — start a debug session for the given program.
  // Disconnects any existing session first so switching files is seamless.
  // Returns { started: true } on success or { started: false, error: string }.
  registry.register('dap:launch', async (adapter, payload, ctx) => {
    const { program, language = 'python', args = [], stopOnEntry = false } =
      payload as { program: string; language?: DebugLang; args?: string[]; stopOnEntry?: boolean }

    // Kill any prior session
    const prior = clientsBySession.get(ctx.sessionId)
    if (prior) {
      await prior.disconnect().catch(() => {})
      clientsBySession.delete(ctx.sessionId)
    }

    const def = getLangAdapter(language)
    const client = new DapClient(adapter, def.command, def.args)
    bindEvents(client, ctx)
    clientsBySession.set(ctx.sessionId, client)

    try {
      await client.launch({ program, language: def.language, args, stopOnEntry })
      return { started: true }
    } catch (err) {
      clientsBySession.delete(ctx.sessionId)
      return { started: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // dap:setBreakpoints — update breakpoints for one source file and signal
  // configurationDone so the adapter starts running the program.
  // Call after dap:launch resolves; can also be called mid-session to update.
  registry.register('dap:setBreakpoints', async (_, payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return { breakpoints: [] }
    const { path: sourcePath, lines } = payload as { path: string; lines: number[] }
    const breakpoints = await client.setBreakpoints(sourcePath, lines)
    await client.configurationDone().catch(() => {})
    return { breakpoints }
  })

  registry.register('dap:continue', async (_, payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return null
    const { threadId = 1 } = (payload ?? {}) as { threadId?: number }
    await client.continue(threadId)
    return null
  })

  registry.register('dap:next', async (_, payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return null
    const { threadId = 1 } = (payload ?? {}) as { threadId?: number }
    await client.next(threadId)
    return null
  })

  registry.register('dap:stepIn', async (_, payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return null
    const { threadId = 1 } = (payload ?? {}) as { threadId?: number }
    await client.stepIn(threadId)
    return null
  })

  registry.register('dap:stepOut', async (_, payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return null
    const { threadId = 1 } = (payload ?? {}) as { threadId?: number }
    await client.stepOut(threadId)
    return null
  })

  registry.register('dap:threads', async (_, _payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return []
    return client.threads()
  })

  registry.register('dap:stackTrace', async (_, payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return []
    const { threadId = 1, startFrame = 0, levels = 20 } = payload as {
      threadId?: number; startFrame?: number; levels?: number
    }
    return client.stackTrace(threadId, startFrame, levels)
  })

  registry.register('dap:variables', async (_, payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return []
    const { frameId } = payload as { frameId: number }
    const scopes = await client.scopes(frameId)
    if (scopes.length === 0) return []
    const vars = await client.variables(scopes[0].variablesReference)
    return vars
  })

  registry.register('dap:evaluate', async (_, payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (!client?.isRunning) return ''
    const { expression, frameId } = payload as { expression: string; frameId?: number }
    return client.evaluate(expression, frameId)
  })

  registry.register('dap:disconnect', async (_, _payload, ctx) => {
    const client = clientsBySession.get(ctx.sessionId)
    if (client) {
      await client.disconnect().catch(() => {})
      clientsBySession.delete(ctx.sessionId)
    }
    return { stopped: true }
  })

  registry.registerCleanup((sessionId) => {
    const client = clientsBySession.get(sessionId)
    if (client) {
      void client.disconnect().catch(() => {})
      clientsBySession.delete(sessionId)
    }
  })
}
