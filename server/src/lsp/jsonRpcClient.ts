import { EventEmitter } from 'node:events'
import type { SandboxAdapter, ProcessHandle } from '../sandbox/types.js'

// Same hand-rolled LSP JSON-RPC framing as desktop's pyrightClient.ts/tsclient.ts
// (Content-Length headers, see https://microsoft.github.io/language-server-protocol/)
// but generalized over any SandboxAdapter's spawnProcess instead of a local
// child_process — the language server now runs wherever the project's files
// actually live (inside the E2B sandbox in production), not on the Node host.
interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export interface LspClientConfig {
  command: string
  args: string[]
  cwd?: string
  languageId: string
  rootUri: string
  initializationOptions?: unknown
  workspaceConfiguration?: unknown
}

export class JsonRpcProcessClient extends EventEmitter {
  private handle: ProcessHandle | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, (result: unknown) => void>()
  private startPromise: Promise<void> | null = null
  private openVersions = new Map<string, number>()

  constructor(private readonly adapter: SandboxAdapter, private readonly config: LspClientConfig) {
    super()
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = (async () => {
      // `handle` is captured locally so a stale onExit from a process killed
      // by stop() can't null out a newer process's state if it fires after
      // start() has already been called again (e.g. restart-after-crash).
      const handle = await this.adapter.spawnProcess(this.config.command, this.config.args, {
        cwd: this.config.cwd,
        onStdout: (chunk) => this.onData(chunk),
        onStderr: () => { /* language server logs — ignored, mirrors desktop's clients */ },
        onExit: () => {
          if (this.handle === handle) {
            this.handle = null
            this.startPromise = null
          }
        },
      })
      this.handle = handle

      await this.request('initialize', {
        processId: null,
        rootUri: this.config.rootUri,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['plaintext', 'markdown'] },
            definition: {},
            publishDiagnostics: {},
          },
        },
        initializationOptions: this.config.initializationOptions,
      })
      this.notify('initialized', {})
      if (this.config.workspaceConfiguration) {
        this.notify('workspace/didChangeConfiguration', { settings: this.config.workspaceConfiguration })
      }
    })()
    return this.startPromise
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.slice(0, headerEnd)
      const match = header.match(/Content-Length: (\d+)/i)
      if (!match) {
        this.buffer = ''
        return
      }
      const length = parseInt(match[1], 10)
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.slice(bodyStart, bodyStart + length)
      this.buffer = this.buffer.slice(bodyStart + length)
      try {
        this.handleMessage(JSON.parse(body) as JsonRpcMessage)
      } catch {
        // malformed frame — drop it
      }
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const resolve = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      resolve?.(msg.error ? null : msg.result)
      return
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.emit('diagnostics', msg.params)
    }
  }

  private send(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg)
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`
    void this.handle?.writeStdin(header + json)
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  async didOpen(uri: string, text: string): Promise<void> {
    await this.start()
    this.openVersions.set(uri, 1)
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: this.config.languageId, version: 1, text },
    })
  }

  async didChange(uri: string, text: string): Promise<void> {
    await this.start()
    const version = (this.openVersions.get(uri) ?? 1) + 1
    this.openVersions.set(uri, version)
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    })
  }

  async hover(uri: string, line: number, character: number): Promise<unknown> {
    await this.start()
    return this.request('textDocument/hover', { textDocument: { uri }, position: { line, character } })
  }

  async definition(uri: string, line: number, character: number): Promise<unknown> {
    await this.start()
    return this.request('textDocument/definition', { textDocument: { uri }, position: { line, character } })
  }

  stop(): void {
    void this.handle?.kill().catch(() => { /* already dead */ })
    this.handle = null
    this.startPromise = null
    this.openVersions.clear()
  }
}
