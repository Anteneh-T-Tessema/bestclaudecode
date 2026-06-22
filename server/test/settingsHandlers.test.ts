import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HandlerRegistry, dispatch, type HandlerContext } from '../src/router.js'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { registerSettingsHandlers } from '../src/handlers/settings.handlers.js'

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lakoora-settings-test-'))
  const adapter = new LocalSandboxAdapter(root)
  const registry = new HandlerRegistry()
  registerSettingsHandlers(registry)
  const ctx: HandlerContext = { sessionId: 'settings-session', send: () => {} }
  return { adapter, registry, ctx }
}

async function call(registry: HandlerRegistry, adapter: LocalSandboxAdapter, ctx: HandlerContext, channel: string, payload: unknown) {
  return dispatch(registry, adapter, ctx, JSON.stringify({ id: '1', channel, payload }))
}

describe('settings handlers', () => {
  test('settings:set then settings:get round-trips a mutable key', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    await call(registry, adapter, ctx, 'settings:set', { key: 'theme', value: 'dark' })
    const res = await call(registry, adapter, ctx, 'settings:get', 'theme')
    assert.equal(res?.result, 'dark')
  })

  test('settings:set rejects a key outside MUTABLE_KEYS/SECRET_KEYS', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    const res = await call(registry, adapter, ctx, 'settings:set', { key: 'arbitraryKey', value: 'x' })
    assert.equal(res?.ok, false)
    assert.match(res?.error ?? '', /not mutable/)
  })

  test('settings:set allows a secret key but settings:getAll never echoes it back', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    await call(registry, adapter, ctx, 'settings:set', { key: 'anthropicApiKey', value: 'sk-ant-secret' })
    await call(registry, adapter, ctx, 'settings:set', { key: 'theme', value: 'light' })

    const direct = await call(registry, adapter, ctx, 'settings:get', 'anthropicApiKey')
    assert.equal(direct?.result, 'sk-ant-secret')

    const all = await call(registry, adapter, ctx, 'settings:getAll', undefined)
    const allResult = all?.result as Record<string, unknown>
    assert.equal(allResult.theme, 'light')
    assert.ok(!('anthropicApiKey' in allResult))
  })

  test('settings are isolated per session', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    const otherCtx: HandlerContext = { sessionId: 'other-session', send: () => {} }
    await call(registry, adapter, ctx, 'settings:set', { key: 'theme', value: 'dark' })
    const otherRes = await call(registry, adapter, otherCtx, 'settings:get', 'theme')
    assert.equal(otherRes?.result, undefined)
  })

  test('settings:validateKey returns valid:false for a bogus key (network error or 401, both caught)', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    const res = await call(registry, adapter, ctx, 'settings:validateKey', { provider: 'anthropic', key: 'sk-ant-definitely-not-real' })
    const result = res?.result as { valid: boolean; error?: string }
    assert.equal(result.valid, false)
  })

  test('registerCleanup clears a session\'s settings', async () => {
    const { adapter, registry, ctx } = await makeFixture()
    await call(registry, adapter, ctx, 'settings:set', { key: 'theme', value: 'dark' })
    registry.cleanupSession(ctx.sessionId)
    const res = await call(registry, adapter, ctx, 'settings:get', 'theme')
    assert.equal(res?.result, undefined)
  })
})
