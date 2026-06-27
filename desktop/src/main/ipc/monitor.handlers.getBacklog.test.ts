/**
 * monitor:getBacklog — separate test file from monitor.handlers.test.ts
 * because this one mocks 'electron' and 'node-pty' (that file deliberately
 * tests only the pure helpers, no mocking needed there).
 *
 * Regression coverage for a real race: a near-instant command (e.g. `echo`)
 * can spawn, run, and emit all its output via term.onData() before the
 * renderer's React effect has subscribed monitor:data:<id> — that effect
 * only runs after monitor:start's IPC round-trip resolves and triggers a
 * re-render. Electron IPC doesn't buffer past sends for a not-yet-subscribed
 * channel, so the output was silently lost. This mock's onData() fires its
 * callback *synchronously, immediately upon registration* — the realistic
 * worst case (data arrives before monitor:start's own IPC response even
 * reaches the caller, let alone before a renderer subscribes) — to prove
 * getBacklog() still has it.
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

/** A fake node-pty module whose onData() immediately fires `emitted` upon registration — simulating data that arrives before any external listener could exist. */
function fakePtyModule(emitted: string | null) {
  return {
    spawn: vi.fn(() => ({
      onData: (cb: (data: string) => void) => { if (emitted) cb(emitted) },
      onExit: () => {},
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
    expect(getBacklogHandler({}, id)).toBe('hello-backlog-test\n')
  })

  it('accumulates multiple chunks emitted before the caller fetches the backlog', async () => {
    let cb: ((data: string) => void) | null = null
    vi.doMock('node-pty', () => ({
      spawn: vi.fn(() => ({
        onData: (handler: (data: string) => void) => { cb = handler },
        onExit: () => {},
        kill: vi.fn(),
      })),
    }))
    const { registerMonitorHandlers } = await import('./monitor.handlers')
    registerMonitorHandlers()

    const startHandler = registeredHandlers.get('monitor:start')!
    const { id } = (await startHandler(fakeEvent(), 'some-command')) as { id?: string }

    cb?.('first chunk\n')
    cb?.('second chunk\n')

    const getBacklogHandler = registeredHandlers.get('monitor:getBacklog')!
    expect(getBacklogHandler({}, id)).toBe('first chunk\nsecond chunk\n')
  })

  it('returns an empty string for an unknown id', async () => {
    vi.doMock('node-pty', () => fakePtyModule(null))
    const { registerMonitorHandlers } = await import('./monitor.handlers')
    registerMonitorHandlers()

    const getBacklogHandler = registeredHandlers.get('monitor:getBacklog')!
    expect(getBacklogHandler({}, 'no-such-id')).toBe('')
  })

  it('monitor:stop clears the backlog for that id', async () => {
    vi.doMock('node-pty', () => fakePtyModule('hi\n'))
    const { registerMonitorHandlers } = await import('./monitor.handlers')
    registerMonitorHandlers()

    const startHandler = registeredHandlers.get('monitor:start')!
    const { id } = (await startHandler(fakeEvent(), 'echo hi')) as { id?: string }

    const stopHandler = registeredHandlers.get('monitor:stop')!
    stopHandler({}, id)

    const getBacklogHandler = registeredHandlers.get('monitor:getBacklog')!
    expect(getBacklogHandler({}, id)).toBe('')
  })
})
