import { ipcMain, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import { store } from '../store'

// Inline re-implementation of DapClient for the Electron main process — can't
// import from server/ (separate package boundary) but the code is identical in
// logic to server/src/dap/dapClient.ts. The two files must stay in sync if
// the DAP protocol surface changes.

interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  arguments?: unknown
  body?: unknown
}

class DesktopDapClient extends EventEmitter {
  private proc: ReturnType<typeof spawn> | null = null
  private buffer = ''
  private nextSeq = 1
  private pending = new Map<number, (body: unknown) => void>()

  get isRunning() { return this.proc !== null }

  async launch(adapterCmd: string, adapterArgs: string[], launchArgs: Record<string, unknown>): Promise<void> {
    const timeout = (ms: number) =>
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`DAP launch timed out after ${ms}ms`)), ms))

    const initializedPromise = new Promise<void>((res) => { this.once('initialized', res) })
    this.proc = spawn(adapterCmd, adapterArgs)
    this.proc.stdout?.on('data', (d: Buffer) => this.onData(d.toString()))
    this.proc.stderr?.on('data', (d: Buffer) => console.error('[DAP adapter stderr]', d.toString()))
    this.proc.on('close', () => { this.proc = null; this.emit('terminated', {}) })

    await Promise.race([
      (async () => {
        await this.request('initialize', {
          adapterID: 'meshflow', pathFormat: 'path',
          linesStartAt1: true, columnsStartAt1: true, supportsRunInTerminalRequest: false,
        })
        await this.request('launch', launchArgs)
        await initializedPromise
      })(),
      timeout(10_000),
    ])
  }

  async setBreakpoints(sourcePath: string, breakpoints: Array<{ line: number; condition?: string }>) {
    const body = await this.request('setBreakpoints', {
      source: { path: sourcePath },
      breakpoints: breakpoints.map((b) => (b.condition ? { line: b.line, condition: b.condition } : { line: b.line })),
      lines: breakpoints.map((b) => b.line),
    }) as { breakpoints?: unknown[] } | null
    return body?.breakpoints ?? []
  }

  async configurationDone() { await this.request('configurationDone', {}) }
  async continue(threadId: number) { await this.request('continue', { threadId }) }
  async next(threadId: number) { await this.request('next', { threadId }) }
  async stepIn(threadId: number) { await this.request('stepIn', { threadId }) }
  async stepOut(threadId: number) { await this.request('stepOut', { threadId }) }

  async threads() {
    const body = await this.request('threads', {}) as { threads?: unknown[] } | null
    return body?.threads ?? []
  }

  async stackTrace(threadId: number, startFrame = 0, levels = 20) {
    const body = await this.request('stackTrace', { threadId, startFrame, levels }) as { stackFrames?: unknown[] } | null
    return body?.stackFrames ?? []
  }

  async scopes(frameId: number) {
    const body = await this.request('scopes', { frameId }) as { scopes?: Array<{ variablesReference: number }> } | null
    return body?.scopes ?? []
  }

  async variables(variablesReference: number) {
    const body = await this.request('variables', { variablesReference }) as { variables?: unknown[] } | null
    return body?.variables ?? []
  }

  async evaluate(expression: string, frameId?: number) {
    const body = await this.request('evaluate', { expression, frameId, context: 'watch' }) as { result?: string } | null
    return body?.result ?? ''
  }

  async disconnect() {
    if (!this.proc) return
    try { await this.request('disconnect', { terminateDebuggee: true }) } catch { /* already dead */ }
    this.proc?.kill()
    this.proc = null
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const match = this.buffer.slice(0, headerEnd).match(/Content-Length: (\d+)/i)
      if (!match) { this.buffer = ''; return }
      const length = parseInt(match[1], 10)
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.slice(bodyStart, bodyStart + length)
      this.buffer = this.buffer.slice(bodyStart + length)
      try { this.handleMessage(JSON.parse(body) as DapMessage) } catch { /* drop */ }
    }
  }

  private handleMessage(msg: DapMessage): void {
    if (msg.type === 'response' && msg.request_seq !== undefined) {
      const res = this.pending.get(msg.request_seq)
      if (res) { this.pending.delete(msg.request_seq); res(msg.success ? msg.body : null) }
      return
    }
    if (msg.type === 'event' && msg.event) this.emit(msg.event, msg.body)
  }

  private send(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg)
    const frame = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`
    this.proc?.stdin?.write(frame)
  }

  private request(command: string, args: unknown): Promise<unknown> {
    const seq = this.nextSeq++
    return new Promise((res) => {
      this.pending.set(seq, res)
      this.send({ seq, type: 'request', command, arguments: args })
    })
  }
}

const clientsByWindow = new Map<number, DesktopDapClient>()

function getRepoRoot(): string {
  return (store.get('projectPath') as string | undefined)
    ?? path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
}

function pyCmd(): string {
  return path.join(getRepoRoot(), '.venv', 'bin', 'python')
}

export function registerDapHandlers(): void {
  ipcMain.handle('dap:launch', async (event, payload: { program: string; language?: string; args?: string[]; stopOnEntry?: boolean }) => {
    const { program, language = 'python', args = [], stopOnEntry = false } = payload
    const windowId = event.sender.id

    const prior = clientsByWindow.get(windowId)
    if (prior) { await prior.disconnect().catch(() => {}); clientsByWindow.delete(windowId) }

    const isNode = language === 'node'
    const adapterCmd = isNode
      ? (process.env.MESHFLOW_JSDBG_BIN ?? 'js-debug-adapter')
      : pyCmd()
    const adapterArgs = isNode ? [] : ['-m', 'debugpy.adapter']

    const client = new DesktopDapClient()
    const send = (channel: string, data: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) event.sender.send(channel, data)
    }
    client.on('stopped', (b) => send('dap:stopped', b))
    client.on('continued', (b) => send('dap:continued', b))
    client.on('terminated', (b) => send('dap:terminated', b))
    client.on('output', (b) => send('dap:output', b))
    client.on('thread', (b) => send('dap:thread', b))
    client.on('breakpoint', (b) => send('dap:breakpoint', b))
    clientsByWindow.set(windowId, client)

    try {
      await client.launch(adapterCmd, adapterArgs, {
        request: 'launch', type: isNode ? 'node' : 'python',
        name: 'Meshflow Debug', program, stopOnEntry, args,
      })
      return { started: true }
    } catch (err) {
      clientsByWindow.delete(windowId)
      return { started: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('dap:setBreakpoints', async (event, payload: { path: string; breakpoints: Array<{ line: number; condition?: string }> }) => {
    const client = clientsByWindow.get(event.sender.id)
    if (!client?.isRunning) return { breakpoints: [] }
    const bps = await client.setBreakpoints(payload.path, payload.breakpoints)
    await client.configurationDone().catch(() => {})
    return { breakpoints: bps }
  })

  ipcMain.handle('dap:continue', async (event, payload?: { threadId?: number }) => {
    await clientsByWindow.get(event.sender.id)?.continue(payload?.threadId ?? 1).catch(() => {})
  })

  ipcMain.handle('dap:next', async (event, payload?: { threadId?: number }) => {
    await clientsByWindow.get(event.sender.id)?.next(payload?.threadId ?? 1).catch(() => {})
  })

  ipcMain.handle('dap:stepIn', async (event, payload?: { threadId?: number }) => {
    await clientsByWindow.get(event.sender.id)?.stepIn(payload?.threadId ?? 1).catch(() => {})
  })

  ipcMain.handle('dap:stepOut', async (event, payload?: { threadId?: number }) => {
    await clientsByWindow.get(event.sender.id)?.stepOut(payload?.threadId ?? 1).catch(() => {})
  })

  ipcMain.handle('dap:threads', async (event) => {
    const client = clientsByWindow.get(event.sender.id)
    if (!client?.isRunning) return []
    return client.threads()
  })

  ipcMain.handle('dap:stackTrace', async (event, payload?: { threadId?: number; startFrame?: number; levels?: number }) => {
    const client = clientsByWindow.get(event.sender.id)
    if (!client?.isRunning) return []
    return client.stackTrace(payload?.threadId ?? 1, payload?.startFrame ?? 0, payload?.levels ?? 20)
  })

  ipcMain.handle('dap:variables', async (event, payload: { frameId: number }) => {
    const client = clientsByWindow.get(event.sender.id)
    if (!client?.isRunning) return []
    const scopes = await client.scopes(payload.frameId)
    if (!scopes.length) return []
    return client.variables(scopes[0].variablesReference)
  })

  ipcMain.handle('dap:evaluate', async (event, payload: { expression: string; frameId?: number }) => {
    const client = clientsByWindow.get(event.sender.id)
    if (!client?.isRunning) return ''
    return client.evaluate(payload.expression, payload.frameId)
  })

  ipcMain.handle('dap:disconnect', async (event) => {
    const client = clientsByWindow.get(event.sender.id)
    if (client) { await client.disconnect().catch(() => {}); clientsByWindow.delete(event.sender.id) }
    return { stopped: true }
  })
}
