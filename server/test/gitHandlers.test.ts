import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HandlerRegistry, dispatch, type HandlerContext } from '../src/router.js'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { registerGitHandlers } from '../src/handlers/git.handlers.js'

// All cwd/path values below are sandbox-virtual paths anchored at the
// adapter's own root (mirroring how E2bSandboxAdapter treats the sandbox VM's
// own "/" — see resolveInRoot in localAdapter.ts) — '.' means "the sandbox
// root", not the real host directory `root` points to.
describe('git handlers over the router', () => {
  let root: string
  let adapter: LocalSandboxAdapter
  let registry: HandlerRegistry
  let ctx: HandlerContext

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lakoora-git-handlers-test-'))
    adapter = new LocalSandboxAdapter(root)
    registry = new HandlerRegistry()
    registerGitHandlers(registry)
    ctx = { sessionId: 's1', send: () => {} }

    // Real git repo fixture — these handlers shell out to the real `git`
    // binary via adapter.runCommand, so the test exercises the actual
    // command-quoting and exit-code handling, not a mock.
    await adapter.runCommand('git init -q -b main', '.')
    await adapter.runCommand('git config user.email test@lakoora.dev', '.')
    await adapter.runCommand('git config user.name "Lakoora Test"', '.')
    await writeFile(path.join(root, 'a.txt'), 'one\n', 'utf-8')
    await adapter.runCommand('git add a.txt', '.')
    await adapter.runCommand('git commit -q -m "initial commit"', '.')
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function call(channel: string, payload: unknown) {
    return dispatch(registry, adapter, ctx, JSON.stringify({ id: '1', channel, payload }))
  }

  test('git:branch reports the current branch', async () => {
    const res = await call('git:branch', '.')
    assert.equal(res?.result, 'main')
  })

  test('git:log returns the commit with hash and message', async () => {
    const res = await call('git:log', '.')
    const entries = res?.result as { hash: string; message: string }[]
    assert.equal(entries.length, 1)
    assert.equal(entries[0].message, 'initial commit')
    assert.match(entries[0].hash, /^[0-9a-f]{7,}$/)
  })

  test('git:status reports clean when there are no changes', async () => {
    const res = await call('git:status', '.')
    assert.deepEqual(res?.result, { modified: 0, added: 0, deleted: 0, total: 0, clean: true })
  })

  test('git:status reports modified files', async () => {
    await writeFile(path.join(root, 'a.txt'), 'two\n', 'utf-8')
    const res = await call('git:status', '.')
    assert.deepEqual(res?.result, { modified: 1, added: 0, deleted: 0, total: 1, clean: false })
    await adapter.runCommand('git checkout -- a.txt', '.')
  })

  test('git:createBranch creates and checks out a new branch', async () => {
    const res = await call('git:createBranch', { cwd: '.', branch: 'feature-x' })
    assert.deepEqual(res?.result, { success: true, branch: 'feature-x' })
    const branch = await call('git:branch', '.')
    assert.equal(branch?.result, 'feature-x')
  })

  test('git:listBranches lists both branches with the current one marked', async () => {
    const res = await call('git:listBranches', '.')
    const { branches, current } = res?.result as { branches: string[]; current: string | null }
    assert.ok(branches.includes('main'))
    assert.ok(branches.includes('feature-x'))
    assert.equal(current, 'feature-x')
  })

  test('git:checkoutBranch switches back to main', async () => {
    const res = await call('git:checkoutBranch', { cwd: '.', branch: 'main' })
    assert.deepEqual(res?.result, { success: true, branch: 'main' })
  })

  test('git:commit with a message containing a single quote does not break the shell command', async () => {
    await writeFile(path.join(root, 'b.txt'), "it's a test\n", 'utf-8')
    await call('git:add', { cwd: '.', paths: ['b.txt'] })
    const res = await call('git:commit', { cwd: '.', message: "fix: handle it's edge case" })
    assert.equal((res?.result as { success: boolean }).success, true)
    const log = await call('git:log', '.')
    const entries = log?.result as { message: string }[]
    assert.equal(entries[0].message, "fix: handle it's edge case")
  })

  test('git:diff returns empty string when the path is not a repo', async () => {
    const res = await call('git:diff', { cwd: 'no-such-repo', path: 'a.txt' })
    assert.equal(res?.result, '')
  })
})
