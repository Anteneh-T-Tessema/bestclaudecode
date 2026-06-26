/**
 * Persistent, append-only deploy history — one hash-chained JSONL file per
 * project (not per agent session; deploys happen outside agent sessions too)
 * at <projectPath>/.meshflow/deploy-history/deploys.jsonl. Same tamper-evident
 * hash-chain shape as agentEventLog.ts, copy-adapted rather than shared
 * since the keying (per-project vs per-session) and lifecycle differ.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { type DeployProvider } from './deploy'

const GENESIS_HASH = '0'.repeat(64)

export interface DeployRecord {
  id: string
  ts: number
  provider: DeployProvider
  deployCmd: string
  target: 'preview' | 'production'
  url?: string
  exitCode: number
  /** Set on a 'promote' record, referencing the preview deploy it promoted. */
  promotedFromId?: string
  /** Set on a record produced by rolling back to a past deployment. */
  rolledBackFromId?: string
  /** Set when this deploy succeeded only after the AI auto-fix loop edited files and retried. */
  selfHealed?: boolean
  hash: string
}

function logPath(projectPath: string): string {
  return path.join(projectPath, '.meshflow', 'deploy-history', 'deploys.jsonl')
}

function computeHash(prevHash: string, record: Record<string, unknown>): string {
  const { hash: _omit, ...rest } = record as { hash?: string } & Record<string, unknown>
  return crypto.createHash('sha256').update(prevHash + JSON.stringify(rest)).digest('hex')
}

/** Appends one deploy record, assigning its hash from the project's chain. Best-effort — never throws. */
export function appendDeployRecord(projectPath: string, record: Omit<DeployRecord, 'hash'>): void {
  try {
    const file = logPath(projectPath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    let prevHash = GENESIS_HASH
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]) as { hash?: string }
        prevHash = last.hash ?? GENESIS_HASH
      }
    }
    const hash = computeHash(prevHash, record)
    fs.appendFileSync(file, JSON.stringify({ ...record, hash }) + '\n')
  } catch {
    // Deploy history is best-effort — must never break a deploy.
  }
}

/** Reads every deploy record for a project, most recent first. Returns [] if no history exists. */
export function listDeployRecords(projectPath: string): DeployRecord[] {
  try {
    const content = fs.readFileSync(logPath(projectPath), 'utf-8')
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DeployRecord)
      .reverse()
  } catch {
    return []
  }
}
