import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LocalSandboxAdapter } from '../src/sandbox/localAdapter.js'

describe('LocalSandboxAdapter', () => {
  let root: string
  let adapter: LocalSandboxAdapter

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lakoora-server-test-'))
    adapter = new LocalSandboxAdapter(root)
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('writeFile then readFile round-trips content', async () => {
    await adapter.writeFile('hello.txt', 'hello world')
    const content = await adapter.readFile('hello.txt')
    assert.equal(content, 'hello world')
  })

  test('readDir lists files and directories', async () => {
    await adapter.makeDir('zdir')
    await adapter.writeFile('afile.txt', 'x')
    const entries = await adapter.readDir('.')
    const names = entries.map((e) => e.name)
    assert.ok(names.includes('zdir'))
    assert.ok(names.includes('afile.txt'))
    assert.equal(entries.find((e) => e.name === 'zdir')?.isDirectory, true)
    assert.equal(entries.find((e) => e.name === 'afile.txt')?.isDirectory, false)
  })

  test('exists reflects file presence', async () => {
    assert.equal(await adapter.exists('hello.txt'), true)
    assert.equal(await adapter.exists('nope.txt'), false)
  })

  test('rename moves a file', async () => {
    await adapter.writeFile('rename-me.txt', 'data')
    await adapter.rename('rename-me.txt', 'renamed.txt')
    assert.equal(await adapter.exists('rename-me.txt'), false)
    assert.equal(await adapter.exists('renamed.txt'), true)
  })

  test('deleteEntry removes a file', async () => {
    await adapter.writeFile('delete-me.txt', 'data')
    await adapter.deleteEntry('delete-me.txt')
    assert.equal(await adapter.exists('delete-me.txt'), false)
  })

  test('runCommand returns stdout and exit code', async () => {
    const result = await adapter.runCommand('echo hello-from-sandbox')
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, /hello-from-sandbox/)
  })

  test('runCommand reports non-zero exit codes', async () => {
    const result = await adapter.runCommand('exit 3')
    assert.equal(result.exitCode, 3)
  })

  test('rejects paths that escape the sandbox root', async () => {
    await assert.rejects(() => adapter.readFile('../../../etc/passwd'), /Access denied/)
  })

  test('makeDir is idempotent for an existing directory', async () => {
    await adapter.makeDir('idempotent-dir')
    await adapter.makeDir('idempotent-dir')
    assert.equal(await adapter.exists('idempotent-dir'), true)
  })
})
