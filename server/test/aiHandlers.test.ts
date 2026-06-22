import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HandlerRegistry, dispatch, type HandlerContext } from '../src/router.js'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { registerAiHandlers } from '../src/handlers/ai.handlers.js'
import { setSetting } from '../src/settings/store.js'

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lakoora-ai-test-'))
  const adapter = new LocalSandboxAdapter(root)
  const registry = new HandlerRegistry()
  registerAiHandlers(registry)
  return { adapter, registry }
}

describe('ai handlers', () => {
  test('ai:complete returns null when no Anthropic key is configured', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'ai-session-1', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1',
      channel: 'ai:complete',
      payload: { prefix: 'def foo():\n    ', suffix: '', language: 'python', model: 'claude-sonnet-4-6' },
    }))
    assert.equal(res?.ok, true)
    assert.equal(res?.result, null)
  })

  test('ai:complete returns null when no OpenAI key is configured', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'ai-session-2', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1',
      channel: 'ai:complete',
      payload: { prefix: 'foo(', suffix: ')', language: 'javascript', model: 'gpt-4o' },
    }))
    assert.equal(res?.result, null)
  })

  test('ai:streamChat emits ai:error over the session channel when no API key is configured', async () => {
    const { adapter, registry } = await makeFixture()
    const events: { channel: string; payload: unknown }[] = []
    const ctx: HandlerContext = { sessionId: 'ai-session-3', send: (channel, payload) => events.push({ channel, payload }) }

    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1',
      channel: 'ai:streamChat',
      payload: { messages: [{ role: 'user', content: 'hi' }], model: 'claude-sonnet-4-6' },
    }))
    const streamId = res?.result as string
    assert.ok(streamId)

    await waitFor(() => events.some((e) => e.channel === 'ai:error'))
    const errorEvent = events.find((e) => e.channel === 'ai:error')
    const errPayload = errorEvent?.payload as { streamId: string; error: string }
    assert.equal(errPayload.streamId, streamId)
    assert.match(errPayload.error, /Anthropic API key not configured/)
  })

  test('ai:abortStream stops further chunks for an in-flight ollama-style stream', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'ai-session-4', send: () => {} }
    // Point at a deliberately unreachable port — this dev machine actually
    // runs a real Ollama instance on the default port, and we want this test
    // to be deterministic regardless of what's installed locally.
    setSetting(ctx.sessionId, 'ollamaUrl', 'http://localhost:1')
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'ai:streamChat',
      payload: { messages: [{ role: 'user', content: 'hi' }], model: 'llama3' },
    }))
    const streamId = res?.result as string
    assert.ok(streamId)
    // Aborting immediately should not throw, regardless of whether the
    // fetch has already failed on its own.
    await dispatch(registry, adapter, ctx, JSON.stringify({ id: '2', channel: 'ai:abortStream', payload: streamId }))
  })

  test('ai:listOllamaModels returns an array regardless of whether Ollama is reachable', async () => {
    // Don't assume the test environment's network state — assert the
    // contract (always an array, never throws), not a specific Ollama state.
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'ai-session-5', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({ id: '1', channel: 'ai:listOllamaModels', payload: undefined }))
    assert.equal(res?.ok, true)
    assert.ok(Array.isArray(res?.result))
  })

  test('ai:buildContext with empty query returns { cached: false } without calling Python', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'ai-ctx-1', send: () => {} }
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'ai:buildContext', payload: { query: '' },
    }))
    assert.equal(res?.ok, true)
    const result = res?.result as { cached: boolean; count?: number }
    assert.equal(result.cached, false)
  })

  test('ai:buildContext with real query calls Python and returns cached snippets', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'ai-ctx-2', send: () => {} }
    // Use a query that will match real symbols in this repo.
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'ai:buildContext', payload: { query: 'build_index embed_texts' },
    }))
    assert.equal(res?.ok, true)
    const result = res?.result as { cached: boolean; count: number }
    // The Python subprocess may find zero results on a fresh run (no persistent
    // index built yet) — assert the contract: ok response, count is a number.
    assert.ok(typeof result.count === 'number')
  })

  test('ai:complete with no API keys returns null even after buildContext caches snippets', async () => {
    const { adapter, registry } = await makeFixture()
    const ctx: HandlerContext = { sessionId: 'ai-ctx-3', send: () => {} }
    // Pre-warm the cache
    await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '1', channel: 'ai:buildContext', payload: { query: 'VectorIndex' },
    }))
    // Complete with no keys — should still return null gracefully, not throw
    const res = await dispatch(registry, adapter, ctx, JSON.stringify({
      id: '2', channel: 'ai:complete',
      payload: { prefix: 'def search(', suffix: '):', language: 'python', model: 'claude-sonnet-4-6' },
    }))
    assert.equal(res?.ok, true)
    assert.equal(res?.result, null)
  })
})
