import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HandlerRegistry, dispatch, type HandlerContext } from '../src/router.js'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { registerTerminalHandlers } from '../src/handlers/terminal.handlers.js'

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
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

describe('terminal handlers over the router', () => {
  let root: string
  let adapter: LocalSandboxAdapter
  let registry: HandlerRegistry

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lakoora-terminal-handlers-test-'))
    adapter = new LocalSandboxAdapter(root)
    registry = new HandlerRegistry()
    registerTerminalHandlers(registry)
  })

  after(async () => {
    await adapter.destroy()
    await rm(root, { recursive: true, force: true })
  })

  async function call(ctx: HandlerContext, channel: string, payload: unknown) {
    return dispatch(registry, adapter, ctx, JSON.stringify({ id: '1', channel, payload }))
  }

  test('terminal:create starts a shell and terminal:write echoes output via session events', async () => {
    const events: { channel: string; payload: unknown }[] = []
    const ctx: HandlerContext = { sessionId: 'term-session', send: (channel, payload) => events.push({ channel, payload }) }

    const created = await call(ctx, 'terminal:create', { cols: 80, rows: 24 })
    const { id } = created?.result as { id: string }
    assert.ok(id)

    await call(ctx, 'terminal:write', { id, data: 'echo terminal-marker-xyz\n' })

    await waitFor(() => events.some((e) => typeof e.payload === 'string' && e.payload.includes('terminal-marker-xyz')))
    const dataEvents = events.filter((e) => e.channel === `terminal:data:${id}`)
    assert.ok(dataEvents.length > 0)

    await call(ctx, 'terminal:kill', { id })
  })

  test('terminal:kill stops the terminal and removes it from session state', async () => {
    const ctx: HandlerContext = { sessionId: 'term-session-2', send: () => {} }
    const created = await call(ctx, 'terminal:create', { cols: 80, rows: 24 })
    const { id } = created?.result as { id: string }

    await call(ctx, 'terminal:kill', { id })
    // Writing to a killed/unknown terminal id should not throw.
    await call(ctx, 'terminal:write', { id, data: 'echo should-not-throw\n' })
  })

  test('registerCleanup removes all terminals for a session without throwing', async () => {
    const ctx: HandlerContext = { sessionId: 'term-session-3', send: () => {} }
    await call(ctx, 'terminal:create', { cols: 80, rows: 24 })
    registry.cleanupSession('term-session-3')
    // Session state is gone — killing again should be a no-op, not a throw.
    registry.cleanupSession('term-session-3')
  })

  test('terminal:runCommand executes and returns stdout/exitCode', async () => {
    const ctx: HandlerContext = { sessionId: 'term-session-4', send: () => {} }
    const res = await call(ctx, 'terminal:runCommand', { command: 'echo run-command-marker' })
    const result = res?.result as { stdout: string; exitCode: number }
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, /run-command-marker/)
  })

  test('terminal:runCommand blocks a dangerous rm -rf command', async () => {
    const ctx: HandlerContext = { sessionId: 'term-session-5', send: () => {} }
    const res = await call(ctx, 'terminal:runCommand', { command: 'rm -rf /' })
    assert.equal(res?.ok, false)
    assert.match(res?.error ?? '', /blocked by Lakoora safety policy/i)
  })
})
