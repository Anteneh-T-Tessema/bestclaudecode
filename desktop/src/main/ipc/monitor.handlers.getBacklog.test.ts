/**
 * monitor:getBacklog — separate test file from monitor.handlers.test.ts
 * because this one mocks 'electron' and 'node-pty' (that file deliberately
 * tests only the pure helpers, no mocking needed there).
 *
 * Regression coverage for a real race: a near-instant command (e.g. `echo`)
 * can spawn, run, and emit all its output (and exit) via term.onData()/
 * onExit() before the renderer's React effect has subscribed
 * monitor:data:<id>/monitor:exit:<id> — that effect only runs after
 * monitor:start's IPC round-trip resolves and triggers a re-render. Electron
 * IPC doesn't buffer past sends for a not-yet-subscribed channel, so both the
 * output and the exit notification were silently lost (confirmed in CI: the
 * Stop button never reverted to Start because the exit event never arrived).
 * This mock's onData()/onExit() fire their callbacks *synchronously,
 * immediately upon registration* — the realistic worst case — to prove
 * getBacklog() still has both.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      registeredHandlers.set(channel, handler)
    },
  },
}))

vi.mock('../store', () => ({
  store: { get: () => undefined },
}))

vi.mock('../paths', () => ({
  repoRoot: () => '/tmp/meshflow-monitor-test',
}))

vi.mock('../monitorAlertLog', () => ({
  appendAlert: () => null,
  listAlerts: () => [],
  clearAlerts: () => {},
}))

/**
 * A fake node-pty module whose onData()/onExit() immediately fire upon
 * registration — simulating data/exit that arrive before any external
 * listener could exist.
 */
function fakePtyModule(emitted: string | null, exitCode: number | null = null) {
  return {
    spawn: vi.fn(() => ({
      onData: (cb: (data: string) => void) => { if (emitted) cb(emitted) },
      onExit: (cb: (e: { exitCode: number }) => void) => { if (exitCode !== null) cb({ exitCode }) },
      kill: vi.fn(),
    })),
  }
}

function fakeEvent() {
  return { sender: { isDestroyed: () => false, send: vi.fn(), on: vi.fn() } }
}

describe('monitor:getBacklog', () => {
  beforeEach(() => {
    registeredHandlers.clear()
    vi.resetModules()
  })

  it('returns data the pty emitted the instant onData was registered, before any external listener could exist', async () => {
    vi.doMock('node-pty', () => fakePtyModule('hello-backlog-test\n'))
    const { registerMonitorHandlers } = await import('./monitor.handlers')
    registerMonitorHandlers()

    const startHandler = registeredHandlers.get('monitor:start')!
    const { id } = (await startHandler(fakeEvent(), 'echo hello-backlog-test')) as { id?: string }
    expect(id).toBeTruthy()

    const getBacklogHandler = registeredHandlers.get('monitor:getBacklog')!
    expect(getBacklogHandler({}, id)).toEqual({ data: 'hello-backlog-test\n', exitCode: null })
  })

  it('accumulates multiple chunks emitted before the caller fetches the backlog', async () => {
    const held: { cb: ((data: string) => void) | null } = { cb: null }
    vi.doMock('node-pty', () => ({
      spawn: vi.fn(() => ({
        onData: (handler: (data: string) => void) => { held.cb = handler },
        onExit: () => {},
        kill: vi.fn(),
      })),
    }))
    const { registerMonitorHandlers } = await import('./monitor.handlers')
    registerMonitorHandlers()

    const startHandler = registeredHandlers.get('monitor:start')!
    const { id } = (await startHandler(fakeEvent(), 'some-command')) as { id?: string }

    held.cb?.('first chunk\n')
    held.cb?.('second chunk\n')

    const getBacklogHandler = registeredHandlers.get('monitor:getBacklog')!
    expect(getBacklogHandler({}, id)).toEqual({ data: 'first chunk\nsecond chunk\n', exitCode: null })
  })

  it('returns empty data and a null exitCode for an unknown id', async () => {
    vi.doMock('node-pty', () => fakePtyModule(null))
    const { registerMonitorHandlers } = await import('./monitor.handlers')
    registerMonitorHandlers()

    const getBacklogHandler = registeredHandlers.get('monitor:getBacklog')!
    expect(getBacklogHandler({}, 'no-such-id')).toEqual({ data: '', exitCode: null })
  })

  it('reports an exit code the pty emitted the instant onExit was registered, before any external listener could exist', async () => {
    vi.doMock('node-pty', () => fakePtyModule('hi\n', 0))
    const { registerMonitorHandlers } = await import('./monitor.handlers')
    registerMonitorHandlers()

    const startHandler = registeredHandlers.get('monitor:start')!
    const { id } = (await startHandler(fakeEvent(), 'echo hi')) as { id?: string }

    const getBacklogHandler = registeredHandlers.get('monitor:getBacklog')!
    expect(getBacklogHandler({}, id)).toEqual({ data: 'hi\n', exitCode: 0 })
  })

  it('monitor:stop clears the backlog and exit code for that id', async () => {
    vi.doMock('node-pty', () => fakePtyModule('hi\n', 0))
    const { registerMonitorHandlers } = await import('./monitor.handlers')
    registerMonitorHandlers()

    const startHandler = registeredHandlers.get('monitor:start')!
    const { id } = (await startHandler(fakeEvent(), 'echo hi')) as { id?: string }

    const stopHandler = registeredHandlers.get('monitor:stop')!
    stopHandler({}, id)

    const getBacklogHandler = registeredHandlers.get('monitor:getBacklog')!
    expect(getBacklogHandler({}, id)).toEqual({ data: '', exitCode: null })
  })
})
