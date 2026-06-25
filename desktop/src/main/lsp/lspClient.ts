import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'

// Generic LSP client over stdio — replaces the duplicated pyrightClient.ts and
// tsclient.ts with one class parameterized by LanguageServerConfig. The wire
// protocol (Content-Length framing + JSON-RPC 2.0) is identical for every
// Language Server Protocol server; only the initialization arguments differ.

export interface LanguageServerConfig {
  command: string
  args: string[]
  rootUri: string
  languageId: string | ((uri: string) => string)
  initializationOptions?: unknown
  workspaceConfiguration?: unknown
}

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export class LspClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, (result: unknown) => void>()
  private startPromise: Promise<void> | null = null
  private openVersions = new Map<string, number>()

  constructor(private readonly config: LanguageServerConfig) {
    super()
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise((resolve, reject) => {
      const proc = spawn(this.config.command, this.config.args)
      this.proc = proc
      proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
      proc.on('error', reject)
      proc.on('exit', () => { this.proc = null; this.startPromise = null })

      this.request('initialize', {
        processId: process.pid,
        rootUri: this.config.rootUri,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['plaintext', 'markdown'] },
            definition: {},
            typeDefinition: {},
            implementation: {},
            references: {},
            codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor'] } } },
            rename: {},
            formatting: {},
            publishDiagnostics: {},
            signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true } } },
            completion: { completionItem: { snippetSupport: true } },
            inlayHint: {},
            foldingRange: {},
          },
        },
        initializationOptions: this.config.initializationOptions,
      })
        .then(() => {
          this.notify('initialized', {})
          if (this.config.workspaceConfiguration) {
            this.notify('workspace/didChangeConfiguration', {
              settings: this.config.workspaceConfiguration,
            })
          }
          resolve()
        })
        .catch(reject)
    })
    return this.startPromise
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8')
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
      try { this.handleMessage(JSON.parse(body) as JsonRpcMessage) } catch { /* drop */ }
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const resolve = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      resolve(msg.error ? null : msg.result)
      return
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.emit('diagnostics', msg.params)
    }
  }

  private send(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg)
    this.proc?.stdin.write(`Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`)
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

  private langId(uri: string): string {
    return typeof this.config.languageId === 'function'
      ? this.config.languageId(uri)
      : this.config.languageId
  }

  async didOpen(uri: string, text: string): Promise<void> {
    await this.start()
    this.openVersions.set(uri, 1)
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: this.langId(uri), version: 1, text },
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

  async references(uri: string, line: number, character: number): Promise<unknown> {
    await this.start()
    return this.request('textDocument/references', {
      textDocument: { uri }, position: { line, character },
      context: { includeDeclaration: true },
    })
  }

  async codeAction(uri: string, range: unknown, diagnostics: unknown[]): Promise<unknown> {
    await this.start()
    return this.request('textDocument/codeAction', {
      textDocument: { uri }, range, context: { diagnostics },
    })
  }

  async executeCommand(command: string, args: unknown[]): Promise<unknown> {
    await this.start()
    return this.request('workspace/executeCommand', { command, arguments: args })
  }

  async rename(uri: string, line: number, character: number, newName: string): Promise<unknown> {
    await this.start()
    return this.request('textDocument/rename', { textDocument: { uri }, position: { line, character }, newName })
  }

  // Gap 105 — "Format Document", backed by textDocument/formatting.
  async format(uri: string, tabSize: number, insertSpaces: boolean): Promise<unknown> {
    await this.start()
    return this.request('textDocument/formatting', {
      textDocument: { uri }, options: { tabSize, insertSpaces },
    })
  }

  // Gap 109 — "Signature Help": parameter doc popup triggered on ( and ,
  async signatureHelp(uri: string, line: number, character: number): Promise<unknown> {
    await this.start()
    return this.request('textDocument/signatureHelp', {
      textDocument: { uri }, position: { line, character },
    })
  }

  // Gap 110 — LSP-backed completions (separate from AI inline completions)
  async completion(uri: string, line: number, character: number): Promise<unknown> {
    await this.start()
    return this.request('textDocument/completion', {
      textDocument: { uri }, position: { line, character },
      context: { triggerKind: 1 },
    })
  }

  // Gap 111 — Inlay hints: type annotations and param names rendered inline
  async inlayHint(uri: string, startLine: number, endLine: number): Promise<unknown> {
    await this.start()
    return this.request('textDocument/inlayHint', {
      textDocument: { uri },
      range: { start: { line: startLine, character: 0 }, end: { line: endLine, character: 0 } },
    })
  }

  // Gap 112 — Code folding regions from the language server
  async foldingRange(uri: string): Promise<unknown> {
    await this.start()
    return this.request('textDocument/foldingRange', { textDocument: { uri } })
  }

  // Gap 113 — "Go to Type Definition"
  async typeDefinition(uri: string, line: number, character: number): Promise<unknown> {
    await this.start()
    return this.request('textDocument/typeDefinition', {
      textDocument: { uri }, position: { line, character },
    })
  }

  // Gap 114 — "Go to Implementation"
  async implementation(uri: string, line: number, character: number): Promise<unknown> {
    await this.start()
    return this.request('textDocument/implementation', {
      textDocument: { uri }, position: { line, character },
    })
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
    this.startPromise = null
    this.openVersions.clear()
  }
}
