import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import { repoRoot, venvPython } from '../paths'

// Minimal hand-rolled LSP JSON-RPC client over stdio — talks to pyright-langserver
// directly rather than pulling in vscode-languageclient/monaco-languageclient, since
// we only need four request types (hover, definition, didOpen/didChange) plus the
// publishDiagnostics push notification. LSP framing is just HTTP-style headers:
//   Content-Length: <n>\r\n\r\n<json>
interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

interface Diagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  message: string
  source?: string
}

class PyrightClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, (result: unknown) => void>()
  private startPromise: Promise<void> | null = null
  private openVersions = new Map<string, number>()

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise((resolve, reject) => {
      const binPath = path.join(repoRoot(), 'desktop', 'node_modules', '.bin', 'pyright-langserver')
      const proc = spawn(binPath, ['--stdio'])
      this.proc = proc
      proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
      proc.on('error', reject)
      proc.on('exit', () => {
        this.proc = null
        this.startPromise = null
      })

      this.request('initialize', {
        processId: process.pid,
        rootUri: `file://${repoRoot()}`,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['plaintext', 'markdown'] },
            definition: {},
            publishDiagnostics: {},
          },
        },
        initializationOptions: {
          settings: { python: { pythonPath: venvPython() } },
        },
      })
        .then(() => {
          this.notify('initialized', {})
          // pyright reads the interpreter from workspace config, not initializationOptions
          // alone — without this, it falls back to whatever python3 is on PATH instead of
          // the project's .venv, missing any venv-installed packages when resolving imports.
          this.notify('workspace/didChangeConfiguration', {
            settings: { python: { pythonPath: venvPython() } },
          })
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
      const resolve = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      resolve(msg.error ? null : msg.result)
      return
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.emit('diagnostics', msg.params as { uri: string; diagnostics: Diagnostic[] })
    }
  }

  private send(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg)
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`
    this.proc?.stdin.write(header + json)
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
      textDocument: { uri, languageId: 'python', version: 1, text },
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
    this.proc?.kill()
    this.proc = null
    this.startPromise = null
    this.openVersions.clear()
  }
}

export const pyrightClient = new PyrightClient()
