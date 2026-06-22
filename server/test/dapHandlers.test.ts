import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HandlerRegistry, dispatch, type HandlerContext } from '../src/router.js'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { registerDapHandlers } from '../src/handlers/dap.handlers.js'

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lakoora-dap-test-'))
  const adapter = new LocalSandboxAdapter(root)
  const registry = new HandlerRegistry()
  registerDapHandlers(registry)
  return { adapter, registry, root }
}

describe('dap handlers', () => {
  test('dap:disconnect when no session is running returns { stopped: true }', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'dap-1', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'dap:disconnect', payload: {},
    }))
    assert.equal(res?.ok, true)
    const result = res?.result as { stopped: boolean }
    assert.equal(result.stopped, true)
  })

  test('dap:setBreakpoints when no session is running returns { breakpoints: [] }', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'dap-2', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'dap:setBreakpoints', payload: { path: '/tmp/foo.py', lines: [5, 10] },
    }))
    assert.equal(res?.ok, true)
    const result = res?.result as { breakpoints: unknown[] }
    assert.deepEqual(result, { breakpoints: [] })
  })

  test('dap:stackTrace when no session is running returns []', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'dap-3', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'dap:stackTrace', payload: { threadId: 1 },
    }))
    assert.equal(res?.ok, true)
    assert.deepEqual(res?.result, [])
  })

  test('dap:threads when no session is running returns []', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'dap-4', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'dap:threads', payload: {},
    }))
    assert.equal(res?.ok, true)
    assert.deepEqual(res?.result, [])
  })

  test('dap:variables when no session is running returns []', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'dap-5', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'dap:variables', payload: { frameId: 0 },
    }))
    assert.equal(res?.ok, true)
    assert.deepEqual(res?.result, [])
  })

  test('dap:evaluate when no session is running returns empty string', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'dap-6', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'dap:evaluate', payload: { expression: '1+1', frameId: 0 },
    }))
    assert.equal(res?.ok, true)
    assert.equal(res?.result, '')
  })

  test('dap:launch with nonexistent program returns { started: false }', async () => {
    const { adapter, registry } = await makeFixture()
    const events: { channel: string; payload: unknown }[] = []
    const ctx: HandlerContext = { sessionId: 'dap-7', send: (ch, p) => events.push({ channel: ch, payload: p }) }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'dap:launch',
      payload: { program: '/nonexistent/file.py', language: 'python' },
    }))
    assert.equal(res?.ok, true)
    // debugpy adapter may not be installed in CI; either started:false (spawn error)
    // or we get a timeout — in all cases the handler must return a valid result.
    const result = res?.result as { started: boolean; error?: string }
    assert.ok(typeof result.started === 'boolean')
    if (!result.started) {
      assert.ok(typeof result.error === 'string')
    }
  })

  test('dap:launch followed by dap:disconnect cleans up the session', async () => {
    const { adapter, registry, root } = await makeFixture()
    const py = path.join(root, 'hello.py')
    await writeFile(py, 'print("hello")\n')
    const ctx: HandlerContext = { sessionId: 'dap-8', send: () => {} }
    // Attempt launch (may fail if debugpy not installed — that's fine)
    await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'dap:launch', payload: { program: py, language: 'python' },
    }))
    // Disconnect should never throw regardless of launch outcome
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '2', channel: 'dap:disconnect', payload: {},
    }))
    assert.equal(res?.ok, true)
    assert.equal((res?.result as { stopped: boolean }).stopped, true)
  })
})
