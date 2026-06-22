import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { JsonRpcProcessClient } from '../src/lsp/jsonRpcClient.js'

// dist/test -> server/ -> repo root -> desktop/node_modules/.bin
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const PYRIGHT_BIN = path.join(REPO_ROOT, 'desktop', 'node_modules', '.bin', 'pyright-langserver')

// Proves the whole pipeline against the real binary (not a fixture): spawn
// pyright-langserver through our SandboxAdapter abstraction, perform the LSP
// initialize handshake, open a file with an actual undefined-name error, and
// confirm pyright pushes a real diagnostic back through our framing code.
// Skips gracefully if the binary isn't installed (e.g. on a fresh checkout
// before `cd desktop && npm install`).
describe('JsonRpcProcessClient against the real pyright-langserver binary', { skip: !existsSync(PYRIGHT_BIN) }, () => {
  test('didOpen on a file with an undefined name produces a real diagnostic', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lakoora-lsp-real-test-'))
    await writeFile(path.join(root, 'bad.py'), 'print(totally_undefined_name)\n', 'utf-8')
    const adapter = new LocalSandboxAdapter(root)
    const client = new JsonRpcProcessClient(adapter, {
      command: PYRIGHT_BIN,
      args: ['--stdio'],
      languageId: 'python',
      rootUri: `file://${root}`,
    })

    const diagnosticsEvent = new Promise<{ uri: string; diagnostics: { message: string }[] }>((resolve) => {
      client.on('diagnostics', resolve)
    })

    await client.start()
    await client.didOpen(`file://${root}/bad.py`, 'print(totally_undefined_name)\n')

    const params = await Promise.race([
      diagnosticsEvent,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timed out waiting for pyright diagnostics')), 15_000)
      }),
    ])

    assert.ok(params.diagnostics.length > 0, 'expected at least one diagnostic from pyright')
    const messages = params.diagnostics.map((d) => d.message).join(' ')
    assert.match(messages, /not defined|is unknown|reportUndefinedVariable/i)

    client.stop()
    await adapter.destroy()
  })
})
