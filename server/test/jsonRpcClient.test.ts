import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { JsonRpcProcessClient } from '../src/lsp/jsonRpcClient.js'

// __dirname here is dist/test (compiled output) — fixtures/ is plain JS and
// is never compiled, so resolve back up to the source test/ directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'fakeLspServer.mjs')

async function makeClient(): Promise<{ client: JsonRpcProcessClient; adapter: LocalSandboxAdapter }> {
  const root = await mkdtemp(path.join(tmpdir(), 'lakoora-lsp-test-'))
  const adapter = new LocalSandboxAdapter(root)
  const client = new JsonRpcProcessClient(adapter, {
    command: process.execPath,
    args: [FIXTURE],
    languageId: 'python',
    rootUri: 'file:///',
  })
  return { client, adapter }
}

describe('JsonRpcProcessClient (against a fake LSP server fixture)', () => {
  test('initialize handshake resolves and hover round-trips a result', async () => {
    const { client, adapter } = await makeClient()
    await client.start()
    const result = await client.hover('file:///a.py', 0, 0)
    assert.deepEqual(result, { contents: 'fake hover text' })
    client.stop()
    await adapter.destroy()
  })

  test('didOpen triggers a publishDiagnostics push emitted as a "diagnostics" event', async () => {
    const { client, adapter } = await makeClient()

    const diagnosticsEvent = new Promise<{ uri: string; diagnostics: { message: string }[] }>((resolve) => {
      client.on('diagnostics', resolve)
    })

    await client.didOpen('file:///a.py', 'x = 1\n')
    const params = await diagnosticsEvent

    assert.equal(params.uri, 'file:///a.py')
    assert.equal(params.diagnostics[0].message, 'fake diagnostic')

    client.stop()
    await adapter.destroy()
  })

  test('stop() kills the process so a fresh start() can be issued again', async () => {
    const { client, adapter } = await makeClient()
    await client.start()
    client.stop()
    await client.start()
    const result = await client.hover('file:///b.py', 0, 0)
    assert.deepEqual(result, { contents: 'fake hover text' })
    client.stop()
    await adapter.destroy()
  })
})
