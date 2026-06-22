import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HandlerRegistry, dispatch, type HandlerContext } from '../src/router.js'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { registerSearchHandlers } from '../src/handlers/search.handlers.js'

// These handlers always search Lakoora's own repo (see search.handlers.ts's
// REPO_ROOT comment) rather than the session's sandbox, so the adapter here
// is just a throwaway required by the HandlerRegistry's call signature.
async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lakoora-search-handlers-test-'))
  const adapter = new LocalSandboxAdapter(root)
  const registry = new HandlerRegistry()
  registerSearchHandlers(registry)
  const ctx: HandlerContext = { sessionId: 'search-session', send: () => {} }
  return { adapter, registry, ctx }
}

async function call(registry: HandlerRegistry, adapter: LocalSandboxAdapter, ctx: HandlerContext, channel: string, payload: unknown) {
  return dispatch(registry, adapter, ctx, JSON.stringify({ id: '1', channel, payload }))
}

describe('search handlers (real Python subprocess against the actual repo)', () => {
  test('search:bm25 finds a real symbol in this repo', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    const res = await call(registry, adapter, ctx, 'search:bm25', 'decision log')
    assert.equal(res?.ok, true)
    const result = res?.result as { docCount: number; results: Array<{ file: string }> }
    assert.ok(result.docCount > 0)
    assert.ok(result.results.some((r) => r.file.includes('decision_log')))
  })

  test('search:tfidf finds a real symbol in this repo', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    const res = await call(registry, adapter, ctx, 'search:tfidf', 'evict cache')
    assert.equal(res?.ok, true)
    const result = res?.result as { results: Array<{ file: string }> }
    assert.ok(result.results.some((r) => r.file.includes('cache_manager')))
  })

  test('search:vector finds a real symbol in this repo using the local embedder', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    const res = await call(registry, adapter, ctx, 'search:vector', { query: 'decision log audit', hybrid: false })
    assert.equal(res?.ok, true)
    const result = res?.result as { backend: string; results: Array<{ file: string }> }
    assert.equal(result.backend, 'local-hash')
    assert.ok(result.results.some((r) => r.file.includes('decision_log')))
  })

  test('search:vector with hybrid:true runs without error', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    const res = await call(registry, adapter, ctx, 'search:vector', { query: 'evict cache lru', hybrid: true })
    assert.equal(res?.ok, true)
    const result = res?.result as { results: unknown[] }
    assert.ok(Array.isArray(result.results))
  })

  test('search results include a code snippet enriched from the real file', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    const res = await call(registry, adapter, ctx, 'search:bm25', 'decision log')
    const result = res?.result as { results: Array<{ snippet?: string }> }
    assert.ok(result.results.some((r) => r.snippet && r.snippet.length > 0))
  })
})
