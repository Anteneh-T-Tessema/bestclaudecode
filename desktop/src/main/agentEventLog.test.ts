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

import { appendEvent, readEvents, listSessions, verifyEventLog, computeComplianceSummary } from './agentEventLog'

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

  it('appends events with incrementing sequence numbers, a timestamp, and a hash', () => {
    appendEvent('s1', { status: 'running', subtaskId: 'a' })
    appendEvent('s1', { status: 'done', subtaskId: 'a' })

    const events = readEvents('s1')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ seq: 1, status: 'running', subtaskId: 'a' })
    expect(events[1]).toMatchObject({ seq: 2, status: 'done', subtaskId: 'a' })
    expect(typeof events[0].ts).toBe('number')
    expect(typeof events[0].hash).toBe('string')
    expect(events[0].hash).not.toBe(events[1].hash)
  })

  it('keeps separate logs per session id', () => {
    appendEvent('s1', { status: 'running' })
    appendEvent('s2', { status: 'preparing' })

    expect(readEvents('s1')).toHaveLength(1)
    expect(readEvents('s2')).toHaveLength(1)
  })

  it('lists recorded sessions with branch and start time', () => {
    appendEvent('s1', { status: 'preparing', branch: 'agent/fix-auth-1' })
    appendEvent('s1', { status: 'running' })
    appendEvent('s2', { status: 'running' })

    const sessions = listSessions()
    expect(sessions.map((s) => s.id).sort()).toEqual(['s1', 's2'])
    const s1 = sessions.find((s) => s.id === 's1')
    expect(s1?.branch).toBe('agent/fix-auth-1')
    expect(typeof s1?.startedAt).toBe('number')
  })

  it('never throws even if the log directory cannot be created', () => {
    projectPath = '/dev/null/not-writable'
    expect(() => appendEvent('s1', { status: 'running' })).not.toThrow()
    expect(readEvents('s1')).toEqual([])
  })
})

describe('verifyEventLog', () => {
  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lakoora-event-log-'))
  })

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true })
  })

  it('is valid (vacuously) for a session with no recorded events', () => {
    expect(verifyEventLog('missing')).toEqual({ valid: true, totalEvents: 0 })
  })

  it('is valid for an untampered log', () => {
    appendEvent('s1', { status: 'running' })
    appendEvent('s1', { status: 'done' })
    expect(verifyEventLog('s1')).toEqual({ valid: true, totalEvents: 2 })
  })

  it('detects a tampered record', () => {
    appendEvent('s1', { status: 'running' })
    appendEvent('s1', { status: 'blocked', error: 'original error' })

    const file = path.join(projectPath, '.lakoora', 'agent-events', 's1.jsonl')
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    const tampered = { ...JSON.parse(lines[1]), error: 'a forged, less alarming error' }
    lines[1] = JSON.stringify(tampered)
    fs.writeFileSync(file, lines.join('\n') + '\n')

    const result = verifyEventLog('s1')
    expect(result.valid).toBe(false)
    expect(result.brokenAtSeq).toBe(2)
  })

  it('detects a deleted record by breaking the chain at the next surviving one', () => {
    appendEvent('s1', { status: 'running' })
    appendEvent('s1', { status: 'blocked', error: 'should not be erased' })
    appendEvent('s1', { status: 'finished' })

    const file = path.join(projectPath, '.lakoora', 'agent-events', 's1.jsonl')
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    fs.writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n') // drop the middle "blocked" record

    expect(verifyEventLog('s1').valid).toBe(false)
  })
})

describe('computeComplianceSummary', () => {
  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lakoora-event-log-'))
  })

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true })
  })

  it('returns all zeros when there are no recorded sessions', () => {
    expect(computeComplianceSummary()).toEqual({
      totalSessions: 0, totalBlockedEvents: 0, totalErrorEvents: 0,
      totalApprovalRequests: 0, totalApproved: 0, totalRejected: 0,
    })
  })

  it('aggregates blocked, error, and approval events across sessions', () => {
    appendEvent('s1', { status: 'running' })
    appendEvent('s1', { status: 'blocked', error: 'policy violation' })
    appendEvent('s1', { status: 'pending-approval' })
    appendEvent('s1', { status: 'approval-rejected' })

    appendEvent('s2', { status: 'running' })
    appendEvent('s2', { status: 'pending-approval' })
    appendEvent('s2', { status: 'running' }) // approved — no approval-rejected follows
    appendEvent('s2', { status: 'error', error: 'boom' })

    expect(computeComplianceSummary()).toEqual({
      totalSessions: 2,
      totalBlockedEvents: 1,
      totalErrorEvents: 1,
      totalApprovalRequests: 2,
      totalApproved: 1,
      totalRejected: 1,
    })
  })
})
