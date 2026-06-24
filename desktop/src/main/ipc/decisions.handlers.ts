/**
 * Decision-log / audit-trail bridge — the flagship "transparency" panel.
 *
 * Pure fs reads of docs/decisions/*.md, written by src/decision_log.py via
 * /implement and friends. No Python subprocess needed for v1: this is a
 * read-only TS port of the parsing logic already verified against this
 * exact repo's file format in mcp-servers/build-log-server/src/index.ts.
 *
 * Field shape follows legacyai-ide's existing decision.analytics.ts port
 * (camelCase, already proven in that app's EvalsPanel "History" tab), with
 * one correction: verdict keys are normalized by splitting on ':' before
 * bucketing ("Blocking: 2 issues" -> "Blocking"), matching the true Python
 * source of truth (src/decision_analytics.py's compute_stats) and the MCP
 * server's get_decision_stats — legacyai-ide's port omits this split.
 */
import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { repoRoot, venvPython } from '../paths'
import { runCommand } from '../pythonBridge'

export interface ParsedDecision {
  filename: string
  task: string
  agent: string
  verdict: string
  retries: number
  outcome: string
  findings: string[]
}

export interface DecisionStats {
  total: number
  withRetry: number
  retryRatePct: number
  verdictCounts: Record<string, number>
  topFindings: string[]
  topFiles: Array<{ file: string; count: number }>
  agents: string[]
}

function decisionsDir(): string {
  // E2E tests point this at an isolated temp fixture dir so test runs never
  // read or write the real project's actual docs/decisions/ audit trail.
  if (process.env.LAKOORA_DECISIONS_DIR) return process.env.LAKOORA_DECISIONS_DIR
  return path.join(repoRoot(), 'docs', 'decisions')
}

function parseDecisionFile(filePath: string): ParsedDecision | null {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  const taskMatch = text.match(/^# Decision: (.+)$/m)
  const agentMatch = text.match(/\*\*Agent\*\*:\s*(.+?)(?:\s{2}|$)/m)
  const retriesMatch = text.match(/\*\*Retries\*\*:\s*(\d+)/m)
  const verdictMatch = text.match(/\*\*Verdict\*\*:\s*(.+?)(?:\s{2}|$)/m)
  const outcomeMatch = text.match(/\*\*Outcome\*\*:\s*(.+?)$/m)

  const findingsBlock = text.match(/## Reviewer findings\n\n([\s\S]+?)(\n##|$)/)
  const findings = findingsBlock
    ? findingsBlock[1]
        .trim()
        .split('\n')
        .map((l) => l.replace(/^- /, '').trim())
        .filter(Boolean)
    : []

  if (!taskMatch || !verdictMatch) return null

  return {
    filename: path.basename(filePath),
    task: taskMatch[1].trim(),
    agent: agentMatch?.[1]?.trim() ?? 'unknown',
    verdict: verdictMatch[1].trim(),
    retries: parseInt(retriesMatch?.[1] ?? '0', 10),
    outcome: outcomeMatch?.[1]?.trim() ?? '',
    findings,
  }
}

export function loadDecisions(overrideDir?: string): ParsedDecision[] {
  const dir = overrideDir ?? decisionsDir()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => parseDecisionFile(path.join(dir, f)))
    .filter((d): d is ParsedDecision => d !== null)
}

export function searchDecisions(query: string, overrideDir?: string): ParsedDecision[] {
  const q = query.toLowerCase()
  if (!q) return loadDecisions(overrideDir)
  return loadDecisions(overrideDir).filter(
    (d) =>
      d.task.toLowerCase().includes(q) ||
      d.outcome.toLowerCase().includes(q) ||
      d.verdict.toLowerCase().includes(q) ||
      d.findings.some((f) => f.toLowerCase().includes(q))
  )
}

export function computeStats(decisions: ParsedDecision[]): DecisionStats {
  if (decisions.length === 0) {
    return { total: 0, withRetry: 0, retryRatePct: 0, verdictCounts: {}, topFindings: [], topFiles: [], agents: [] }
  }

  const withRetry = decisions.filter((d) => d.retries > 0).length
  const verdictCounts: Record<string, number> = {}
  const findingCounts: Record<string, number> = {}
  const fileCounts: Record<string, number> = {}
  const agentSet = new Set<string>()

  const filePattern = /\b([\w/.-]+\.[a-zA-Z]{2,6})\b/g

  for (const d of decisions) {
    // Normalize "Blocking: 2 issues" -> "Blocking" before bucketing, matching
    // src/decision_analytics.py's verdict.split(":")[0] behavior.
    const verdictKey = d.verdict.split(':')[0].trim()
    verdictCounts[verdictKey] = (verdictCounts[verdictKey] ?? 0) + 1
    agentSet.add(d.agent)
    for (const finding of d.findings) {
      findingCounts[finding] = (findingCounts[finding] ?? 0) + 1
      for (const match of finding.matchAll(filePattern)) {
        fileCounts[match[1]] = (fileCounts[match[1]] ?? 0) + 1
      }
    }
  }

  const topFindings = Object.entries(findingCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f]) => f)

  const topFiles = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file, count }))

  return {
    total: decisions.length,
    withRetry,
    retryRatePct: Math.round((withRetry / decisions.length) * 100),
    verdictCounts,
    topFindings,
    topFiles,
    agents: [...agentSet],
  }
}

export interface DecisionLogOpts {
  task: string
  verdict: string
  outcome: string
  agent?: string
  retries?: number
  findings?: string[]
  dir?: string
}

export function registerDecisionsHandlers(): void {
  ipcMain.handle('decisions:list', (_event, overrideDir?: string) => loadDecisions(overrideDir))
  ipcMain.handle('decisions:search', (_event, query: string, overrideDir?: string) => searchDecisions(query, overrideDir))
  ipcMain.handle('decisions:stats', (_event, overrideDir?: string) => computeStats(loadDecisions(overrideDir)))

  // Gap 74 — create-side: write an ADR-style decision log entry via src.decision_log.
  ipcMain.handle('decisions:log', async (_event, opts: DecisionLogOpts): Promise<{ ok: boolean; error?: string }> => {
    const { task, verdict, outcome, agent = 'lakoora-agent', retries = 0, findings = [], dir } = opts
    const args = [
      '-m', 'src.decision_log', '--log',
      '--task', task,
      '--verdict', verdict,
      '--outcome', outcome,
      '--agent', agent,
      '--retries', String(retries),
      ...findings.flatMap((f) => ['--finding', f]),
    ]
    if (dir) args.push('--dir', dir)
    else if (process.env.LAKOORA_DECISIONS_DIR) args.push('--dir', process.env.LAKOORA_DECISIONS_DIR)
    const result = await runCommand(venvPython(), args, repoRoot())
    return result.exitCode === 0 ? { ok: true } : { ok: false, error: result.stderr.trim().slice(0, 200) }
  })
}
