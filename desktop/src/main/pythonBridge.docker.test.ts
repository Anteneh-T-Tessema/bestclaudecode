/**
 * Docker sandbox mode for runCommand() — separate test file from
 * pythonBridge.test.ts because this mocks child_process.spawn (no live
 * Docker daemon is available in CI or, currently, on the dev machine this
 * was built on), while pythonBridge.test.ts deliberately runs real
 * processes to exercise the macOS sandbox-exec modes for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import * as os from 'os'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}))

vi.mock('./paths', () => ({
  repoRoot: () => '/tmp/meshflow-docker-test-repo',
  venvPython: () => 'python3',
}))

interface FakeChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
}

function fakeChild(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

const spawnMock = vi.fn()
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

import { runCommand } from './pythonBridge'
import { store } from './store'

describe('runCommand — docker sandbox mode', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    store.set('useSandboxExec', 'docker')
    store.set('dockerSandboxImage', 'node:22-bookworm')
  })

  it('wraps the command in `docker run --rm` with the workspace mounted at the same path', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const promise = runCommand('npm', ['test'], '/Users/dev/myproject')
    queueMicrotask(() => child.emit('close', 0))
    await promise

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = spawnMock.mock.calls[0]
    expect(bin).toBe('docker')
    expect(args).toEqual([
      'run', '--rm',
      '-v', '/Users/dev/myproject:/Users/dev/myproject',
      '-w', '/Users/dev/myproject',
      'node:22-bookworm',
      'npm', 'test',
    ])
    expect(opts).toEqual({ cwd: '/Users/dev/myproject' })
  })

  it('falls back to repoRoot() for the mount/workdir when no cwd is given', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const promise = runCommand('echo', ['hi'])
    queueMicrotask(() => child.emit('close', 0))
    await promise

    const [, args] = spawnMock.mock.calls[0]
    expect(args).toContain('/tmp/meshflow-docker-test-repo:/tmp/meshflow-docker-test-repo')
    expect(args).toContain('/tmp/meshflow-docker-test-repo')
  })

  it('uses the configured dockerSandboxImage', async () => {
    store.set('dockerSandboxImage', 'python:3.12-slim')
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const promise = runCommand('pytest', [])
    queueMicrotask(() => child.emit('close', 0))
    await promise

    const [, args] = spawnMock.mock.calls[0]
    expect(args).toContain('python:3.12-slim')
  })

  it('defaults to node:22-bookworm when dockerSandboxImage is empty', async () => {
    store.set('dockerSandboxImage', '')
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const promise = runCommand('echo', ['hi'])
    queueMicrotask(() => child.emit('close', 0))
    await promise

    const [, args] = spawnMock.mock.calls[0]
    expect(args).toContain('node:22-bookworm')
  })

  it('fails the command with a clear message — not a silent unsandboxed retry — when docker is not installed', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const promise = runCommand('npm', ['test'])
    queueMicrotask(() => {
      const err = new Error('spawn docker ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      child.emit('error', err)
    })
    const result = await promise

    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain('Docker sandbox is enabled')
    expect(result.stderr).toContain('not found')
    // Exactly one spawn call — no second, unsandboxed attempt with the
    // original bin/args after the docker spawn fails.
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces other spawn errors (e.g. a real non-ENOENT failure) with their original message', async () => {
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const promise = runCommand('npm', ['test'])
    queueMicrotask(() => {
      const err = new Error('spawn docker EACCES') as NodeJS.ErrnoException
      err.code = 'EACCES'
      child.emit('error', err)
    })
    const result = await promise

    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toBe('spawn docker EACCES')
  })

  it('does not wrap the command when sandboxing is disabled', async () => {
    store.set('useSandboxExec', 'never')
    const child = fakeChild()
    spawnMock.mockReturnValue(child)

    const promise = runCommand('npm', ['test'], '/Users/dev/myproject')
    queueMicrotask(() => child.emit('close', 0))
    await promise

    const [bin, args] = spawnMock.mock.calls[0]
    expect(bin).toBe('npm')
    expect(args).toEqual(['test'])
  })
})
