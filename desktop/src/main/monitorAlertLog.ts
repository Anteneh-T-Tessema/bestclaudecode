/**
 * Plain (non-hash-chained) append-only alert log for the Monitor feature, at
 * <projectPath>/.meshflow/monitor-alerts/alerts.jsonl. Deliberately simpler
 * than agentEventLog.ts/deployHistory.ts's hash chains: those exist for
 * governance/audit tamper-evidence; alerts are just operational noise from a
 * log command the user themselves ran, with no audit story requiring it.
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'

export interface AlertRecord {
  id: string
  ts: number
  line: string
  monitorId: string
}

function logPath(projectPath: string): string {
  return path.join(projectPath, '.meshflow', 'monitor-alerts', 'alerts.jsonl')
}

/** Appends one alert line. Best-effort — never throws. Returns the record, or null on failure. */
export function appendAlert(projectPath: string, line: string, monitorId: string): AlertRecord | null {
  try {
    const file = logPath(projectPath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const record: AlertRecord = { id: randomUUID(), ts: Date.now(), line, monitorId }
    fs.appendFileSync(file, JSON.stringify(record) + '\n')
    return record
  } catch {
    return null
  }
}

/** Reads every alert recorded for a project, most recent first. Returns [] if no log exists. */
export function listAlerts(projectPath: string): AlertRecord[] {
  try {
    const content = fs.readFileSync(logPath(projectPath), 'utf-8')
    return content
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AlertRecord)
      .reverse()
  } catch {
    return []
  }
}

/** Clears the alert log for a project. Best-effort — never throws. */
export function clearAlerts(projectPath: string): void {
  try {
    fs.rmSync(logPath(projectPath), { force: true })
  } catch {
    // Best-effort.
  }
}
