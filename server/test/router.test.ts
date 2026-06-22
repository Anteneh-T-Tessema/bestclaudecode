import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HandlerRegistry, dispatch, type HandlerContext } from '../src/router.js'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'

async function makeAdapter(): Promise<LocalSandboxAdapter> {
  const root = await mkdtemp(path.join(tmpdir(), 'lakoora-router-test-'))
  return new LocalSandboxAdapter(root)
}

function makeCtx(): HandlerContext {
  return { sessionId: 's1', send: () => {} }
}

describe('router dispatch', () => {
  test('routes a registered channel to its handler and returns ok:true', async () => {
    const registry = new HandlerRegistry()
    registry.register('echo', async (_adapter, payload) => payload)
    const adapter = await makeAdapter()
    const response = await dispatch(registry, adapter, makeCtx(), JSON.stringify({ id: '1', channel: 'echo', payload: { x: 1 } }))
    assert.deepEqual(response, { id: '1', ok: true, result: { x: 1 } })
  })

  test('returns ok:false for an unregistered channel', async () => {
    const registry = new HandlerRegistry()
    const adapter = await makeAdapter()
    const response = await dispatch(registry, adapter, makeCtx(), JSON.stringify({ id: '2', channel: 'missing', payload: {} }))
    assert.equal(response?.ok, false)
    assert.match(response?.error ?? '', /No handler registered/)
  })

  test('returns ok:false with the error message when the handler throws', async () => {
    const registry = new HandlerRegistry()
    registry.register('boom', async () => { throw new Error('kaboom') })
    const adapter = await makeAdapter()
    const response = await dispatch(registry, adapter, makeCtx(), JSON.stringify({ id: '3', channel: 'boom', payload: {} }))
    assert.equal(response?.ok, false)
    assert.equal(response?.error, 'kaboom')
  })

  test('returns null for malformed JSON input', async () => {
    const registry = new HandlerRegistry()
    const adapter = await makeAdapter()
    const response = await dispatch(registry, adapter, makeCtx(), '{not json')
    assert.equal(response, null)
  })

  test('registering the same channel twice throws', () => {
    const registry = new HandlerRegistry()
    registry.register('dup', async () => null)
    assert.throws(() => registry.register('dup', async () => null), /already registered/)
  })
})
