/**
 * Persistent, append-only event log for autonomous agent sessions — the
 * event-sourcing foundation for replay (Gap 51), audit (Gap 54), and
 * verification reports (Gap 53). One newline-delimited JSON file per
 * session at <projectPath>/.lakoora/agent-events/<sessionId>.jsonl.
 */

import * as fs from 'fs'
import * as path from 'path'
import { store } from './store'
import { repoRoot } from './paths'

function logDir(): string {
  const projectPath = (store.get('projectPath') as string | undefined) || repoRoot()
  return path.join(projectPath, '.lakoora', 'agent-events')
}

function logPath(sessionId: string): string {
  return path.join(logDir(), `${sessionId}.jsonl`)
}

/** Appends one event to the session's log, assigning the next sequence number. Best-effort — never throws. */
export function appendEvent(sessionId: string, event: Record<string, unknown>): void {
  try {
    const dir = logDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = logPath(sessionId)
    let seq = 1
    if (fs.existsSync(file)) {
      seq = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).length + 1
    }
    fs.appendFileSync(file, JSON.stringify({ seq, ts: Date.now(), ...event }) + '\n')
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

/** Lists session ids that have a recorded event log, most recently modified first. */
export function listSessions(): string[] {
  try {
    const dir = logDir()
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ id: f.replace('.jsonl', ''), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((e) => e.id)
  } catch {
    return []
  }
}
