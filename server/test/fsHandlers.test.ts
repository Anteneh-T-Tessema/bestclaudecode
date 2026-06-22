import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HandlerRegistry, dispatch, type HandlerContext, type ResponseMessage } from '../src/router.js'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'
import { registerFsHandlers } from '../src/handlers/fs.handlers.js'

describe('fs handlers over the router', () => {
  let root: string
  let adapter: LocalSandboxAdapter
  let registry: HandlerRegistry
  let ctx: HandlerContext

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lakoora-fs-handlers-test-'))
    adapter = new LocalSandboxAdapter(root)
    registry = new HandlerRegistry()
    registerFsHandlers(registry)
    ctx = { sessionId: 's1', send: () => {} }
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function call(channel: string, payload: unknown): Promise<ResponseMessage | null> {
    return dispatch(registry, adapter, ctx, JSON.stringify({ id: '1', channel, payload }))
  }

  test('fs:writeFile then fs:readFile round-trips through the router', async () => {
    await call('fs:writeFile', { path: 'note.txt', content: 'via router' })
    const res = await call('fs:readFile', { path: 'note.txt' })
    assert.equal(res?.ok, true)
    assert.equal(res?.result, 'via router')
  })

  test('fs:readDir lists written files, directories first', async () => {
    await call('fs:createDir', { path: 'zsubdir' })
    const res = await call('fs:readDir', { path: '.' })
    assert.equal(res?.ok, true)
    const entries = res?.result as { name: string; isDirectory: boolean }[]
    const names = entries.map((e) => e.name)
    assert.ok(names.includes('note.txt'))
    assert.ok(names.includes('zsubdir'))
    assert.equal(entries[0].isDirectory, true)
  })

  test('fs:exists reports true/false correctly', async () => {
    const yes = await call('fs:exists', { path: 'note.txt' })
    const no = await call('fs:exists', { path: 'missing.txt' })
    assert.equal(yes?.result, true)
    assert.equal(no?.result, false)
  })

  test('fs:rename moves a file', async () => {
    await call('fs:writeFile', { path: 'old.txt', content: 'x' })
    await call('fs:rename', { oldPath: 'old.txt', newPath: 'new.txt' })
    assert.equal((await call('fs:exists', { path: 'old.txt' }))?.result, false)
    assert.equal((await call('fs:exists', { path: 'new.txt' }))?.result, true)
  })

  test('fs:deleteEntry removes the file', async () => {
    await call('fs:deleteEntry', { path: 'note.txt' })
    const res = await call('fs:exists', { path: 'note.txt' })
    assert.equal(res?.result, false)
  })
})
