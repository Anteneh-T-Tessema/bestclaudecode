import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

let projectPath = ''

vi.mock('./store', () => ({
  store: { get: (key: string) => (key === 'projectPath' ? projectPath : undefined) },
}))

vi.mock('./paths', () => ({
  repoRoot: () => '/unused-fallback',
}))

import { appendEvent, readEvents, listSessions } from './agentEventLog'

describe('agentEventLog', () => {
  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lakoora-event-log-'))
  })

  afterEach(() => {
    if (fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory()) {
      fs.rmSync(projectPath, { recursive: true, force: true })
    }
  })

  it('returns an empty array for a session with no log', () => {
    expect(readEvents('missing-session')).toEqual([])
  })

  it('appends events with incrementing sequence numbers and a timestamp', () => {
    appendEvent('s1', { status: 'running', subtaskId: 'a' })
    appendEvent('s1', { status: 'done', subtaskId: 'a' })

    const events = readEvents('s1')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ seq: 1, status: 'running', subtaskId: 'a' })
    expect(events[1]).toMatchObject({ seq: 2, status: 'done', subtaskId: 'a' })
    expect(typeof events[0].ts).toBe('number')
  })

  it('keeps separate logs per session id', () => {
    appendEvent('s1', { status: 'running' })
    appendEvent('s2', { status: 'preparing' })

    expect(readEvents('s1')).toHaveLength(1)
    expect(readEvents('s2')).toHaveLength(1)
  })

  it('lists recorded session ids', () => {
    appendEvent('s1', { status: 'running' })
    appendEvent('s2', { status: 'running' })

    expect(listSessions().sort()).toEqual(['s1', 's2'])
  })

  it('never throws even if the log directory cannot be created', () => {
    projectPath = '/dev/null/not-writable'
    expect(() => appendEvent('s1', { status: 'running' })).not.toThrow()
    expect(readEvents('s1')).toEqual([])
  })
})
