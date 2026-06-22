import { EventEmitter } from 'node:events'
import type { SandboxAdapter, ProcessHandle } from '../sandbox/types.js'

// DAP uses the same Content-Length: N\r\n\r\n framing as LSP (both are
// derived from HTTP headers), but the message body format differs:
//   Requests:  { seq, type: 'request', command, arguments? }
//   Responses: { seq, type: 'response', request_seq, success, command, body? }
//   Events:    { seq, type: 'event', event, body? }
// This is the same wire-protocol insight that lets DAP and LSP share a
// transport implementation (Content-Length framing) without sharing any
// higher-level protocol code.

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

export interface DebugLaunchOpts {
  program: string
  language: 'python' | 'node'
  args?: string[]
  stopOnEntry?: boolean
  env?: Record<string, string>
}

export interface Breakpoint {
  id?: number
  verified: boolean
  line: number
  message?: string
}

export interface StackFrame {
  id: number
  name: string
  source?: { path?: string; name?: string }
  line: number
  column: number
}

export interface Scope {
  name: string
  variablesReference: number
  expensive: boolean
}

export interface Variable {
  name: string
  value: string
  type?: string
  variablesReference: number
}

export class DapClient extends EventEmitter {
  private handle: ProcessHandle | null = null
  private buffer = ''
  private nextSeq = 1
  private pending = new Map<number, (body: unknown) => void>()
  private startPromise: Promise<void> | null = null

  constructor(
    private readonly adapter: SandboxAdapter,
    private readonly command: string,
    private readonly commandArgs: string[],
    private readonly cwd?: string,
  ) {
    super()
  }

  // Spawn the adapter, complete the initialize handshake, send launch, and
  // wait for the initialized event (which signals the adapter is ready for
  // setBreakpoints/configurationDone). Returns only when all of that is done.
  async launch(opts: DebugLaunchOpts): Promise<void> {
    if (this.startPromise) await this.startPromise
    this.startPromise = this._doLaunch(opts)
    return this.startPromise
  }

  private async _doLaunch(opts: DebugLaunchOpts): Promise<void> {
    // 10s timeout on the adapter handshake — if the binary doesn't exist or
    // crashes before sending the initialized event, we'd wait forever otherwise.
    let initResolve!: () => void
    let initReject!: (e: Error) => void
    const initializedPromise = new Promise<void>((res, rej) => {
      initResolve = res
      initReject = rej
    })
    const timeout = setTimeout(() => initReject(new Error('DAP adapter did not initialize within 10s')), 10_000)
    this.once('initialized', () => { clearTimeout(timeout); initResolve() })
    this.once('terminated', () => { clearTimeout(timeout); initReject(new Error('DAP adapter exited before initialization')) })

    const handle = await this.adapter.spawnProcess(this.command, this.commandArgs, {
      cwd: this.cwd,
      onStdout: (chunk) => this.onData(chunk),
      onStderr: () => { /* adapter diagnostic logs */ },
      onExit: () => {
        if (this.handle === handle) {
          this.handle = null
          this.startPromise = null
          // Flush pending requests so no caller waits forever
          for (const resolve of this.pending.values()) resolve(null)
          this.pending.clear()
          this.emit('terminated', {})
        }
      },
    })
    this.handle = handle

    await this.request('initialize', {
      adapterID: 'lakoora',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    })

    const launchArgs: Record<string, unknown> = {
      request: 'launch',
      type: opts.language === 'python' ? 'python' : 'node',
      name: 'Lakoora Debug',
      program: opts.program,
      stopOnEntry: opts.stopOnEntry ?? false,
      args: opts.args ?? [],
    }
    if (opts.env) launchArgs.env = opts.env
    await this.request('launch', launchArgs)

    await initializedPromise
  }

  async setBreakpoints(sourcePath: string, lines: number[]): Promise<Breakpoint[]> {
    const body = await this.request('setBreakpoints', {
      source: { path: sourcePath },
      breakpoints: lines.map((line) => ({ line })),
      lines,
    }) as { breakpoints?: Breakpoint[] } | null
    return body?.breakpoints ?? []
  }

  async configurationDone(): Promise<void> {
    await this.request('configurationDone', {})
  }

  async continue(threadId: number): Promise<void> {
    await this.request('continue', { threadId })
  }

  async next(threadId: number): Promise<void> {
    await this.request('next', { threadId })
  }

  async stepIn(threadId: number): Promise<void> {
    await this.request('stepIn', { threadId })
  }

  async stepOut(threadId: number): Promise<void> {
    await this.request('stepOut', { threadId })
  }

  async threads(): Promise<Array<{ id: number; name: string }>> {
    const body = await this.request('threads', {}) as { threads?: Array<{ id: number; name: string }> } | null
    return body?.threads ?? []
  }

  async stackTrace(threadId: number, startFrame = 0, levels = 20): Promise<StackFrame[]> {
    const body = await this.request('stackTrace', { threadId, startFrame, levels }) as { stackFrames?: StackFrame[] } | null
    return body?.stackFrames ?? []
  }

  async scopes(frameId: number): Promise<Scope[]> {
    const body = await this.request('scopes', { frameId }) as { scopes?: Scope[] } | null
    return body?.scopes ?? []
  }

  async variables(variablesReference: number): Promise<Variable[]> {
    const body = await this.request('variables', { variablesReference }) as { variables?: Variable[] } | null
    return body?.variables ?? []
  }

  async evaluate(expression: string, frameId?: number): Promise<string> {
    const body = await this.request('evaluate', { expression, frameId, context: 'watch' }) as { result?: string } | null
    return body?.result ?? ''
  }

  async disconnect(): Promise<void> {
    if (!this.handle) return
    try {
      await this.request('disconnect', { terminateDebuggee: true })
    } catch { /* adapter may have already exited */ }
    void this.handle?.kill().catch(() => {})
    this.handle = null
    this.startPromise = null
  }

  // ---- Content-Length framing (identical to jsonRpcClient.ts) ---------------

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.slice(0, headerEnd)
      const match = header.match(/Content-Length: (\d+)/i)
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
      const resolve = this.pending.get(msg.request_seq)
      if (resolve) {
        this.pending.delete(msg.request_seq)
        resolve(msg.success ? msg.body : null)
      }
      return
    }
    if (msg.type === 'event' && msg.event) {
      // When the adapter terminates, reject all in-flight requests so callers
      // don't wait indefinitely for responses that will never arrive.
      if (msg.event === 'terminated') {
        for (const resolve of this.pending.values()) resolve(null)
        this.pending.clear()
      }
      this.emit(msg.event, msg.body)
    }
  }

  private send(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg)
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`
    void this.handle?.writeStdin(header + json)
  }

  private request(command: string, args: unknown): Promise<unknown> {
    // If the process has already exited, resolve immediately with null so
    // callers don't hang. The `terminated` rejection of initializedPromise
    // (via initReject) will surface the real error once the awaits unwind.
    if (!this.handle) return Promise.resolve(null)
    const seq = this.nextSeq++
    return new Promise((resolve) => {
      this.pending.set(seq, resolve)
      this.send({ seq, type: 'request', command, arguments: args })
    })
  }

  get isRunning(): boolean {
    return this.handle !== null
  }
}
