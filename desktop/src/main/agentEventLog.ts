/**
 * Persistent, append-only event log for autonomous agent sessions — the
 * event-sourcing foundation for replay (Gap 51), audit (Gap 54), and
 * verification reports (Gap 53). One newline-delimited JSON file per
 * session at <projectPath>/.lakoora/agent-events/<sessionId>.jsonl.
 *
 * Each record is hash-chained (Gap 60): its `hash` covers the previous
 * record's hash plus its own content, so editing or deleting a past line
 * breaks the chain from that point on — a verifiable tamper-evidence
 * property an auditor can check without trusting the IDE that wrote it.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { store } from './store'
import { repoRoot } from './paths'

const GENESIS_HASH = '0'.repeat(64)

function logDir(): string {
  const projectPath = (store.get('projectPath') as string | undefined) || repoRoot()
  return path.join(projectPath, '.lakoora', 'agent-events')
}

function logPath(sessionId: string): string {
  return path.join(logDir(), `${sessionId}.jsonl`)
}

function computeHash(prevHash: string, record: Record<string, unknown>): string {
  const { hash: _omit, ...rest } = record as { hash?: string } & Record<string, unknown>
  return crypto.createHash('sha256').update(prevHash + JSON.stringify(rest)).digest('hex')
}

/** Appends one event to the session's log, assigning the next sequence number and hash. Best-effort — never throws. */
export function appendEvent(sessionId: string, event: Record<string, unknown>): void {
  try {
    const dir = logDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = logPath(sessionId)
    let seq = 1
    let prevHash = GENESIS_HASH
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
      seq = lines.length + 1
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]) as { hash?: string }
        prevHash = last.hash ?? GENESIS_HASH
      }
    }
    const record = { seq, ts: Date.now(), ...event }
    const hash = computeHash(prevHash, record)
    fs.appendFileSync(file, JSON.stringify({ ...record, hash }) + '\n')
  } catch {
    // Logging failure must never break the agent loop.
  }
}

/** Reads every event recorded for a session, in sequence order. Returns [] if no log exists. */
export function readEvents(sessionId: string): Array<Record<string, unknown>> {
  try {
    const content = fs.readFileSync(logPath(sessionId), 'utf-8')
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
  } catch {
    return []
  }
}

export interface VerifyResult {
  valid: boolean
  /** Sequence number of the first record whose hash doesn't match, if any. */
  brokenAtSeq?: number
  totalEvents: number
}

/** Re-walks a session's log recomputing the hash chain — detects any edited, reordered, or deleted record. */
export function verifyEventLog(sessionId: string): VerifyResult {
  const events = readEvents(sessionId)
  let prevHash = GENESIS_HASH
  for (const event of events) {
    const expected = computeHash(prevHash, event)
    if (event.hash !== expected) {
      return { valid: false, brokenAtSeq: event.seq as number, totalEvents: events.length }
    }
    prevHash = event.hash as string
  }
  return { valid: true, totalEvents: events.length }
}

export interface SessionSummary {
  id: string
  /** Branch the agent worked on, read from the first recorded event that has one. */
  branch?: string
  /** Timestamp of the first recorded event, used for display and sorting. */
  startedAt: number
}

/** Lists every session with a recorded event log, most recently started first. */
export function listSessions(): SessionSummary[] {
  try {
    const dir = logDir()
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const id = f.replace('.jsonl', '')
        const events = readEvents(id)
        const first = events[0]
        const branch = events.find((e) => typeof e.branch === 'string')?.branch as string | undefined
        const startedAt = (first?.ts as number | undefined) ?? fs.statSync(path.join(dir, f)).mtimeMs
        return { id, branch, startedAt }
      })
      .sort((a, b) => b.startedAt - a.startedAt)
  } catch {
    return []
  }
}
