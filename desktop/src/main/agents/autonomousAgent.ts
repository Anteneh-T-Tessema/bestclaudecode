/**
 * Autonomous agent orchestrator — runs a task plan subtask-by-subtask without
 * user interaction.  Called from agent.handlers.ts via IPC.
 *
 * Loop per subtask:
 *   1. Prompt AI with the subtask description + current repo context.
 *   2. Collect the full streamed response.
 *   3. Parse <<<EDIT>>> blocks → write to disk (or shadow workspace if enabled).
 *   4. Parse <<<RUN>>> blocks → check against safety blocklist → exec once.
 *   5. Parse <<<BROWSE>>> blocks → drive a headless browser via src.browser_context.
 *   6. On success: markDone, emit progress, advance to next subtask.
 *   7. On failure: retry once with the error as context, then pause.
 *
 * Isolation: all of the above runs against an isolated git worktree, not the
 * user's live checkout — see setUpWorktree()/finalize() below. Edits never
 * touch projectPath directly until they've been committed, pushed, and PR'd.
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { runPythonJson, runCommand } from '../pythonBridge'
import { repoRoot } from '../paths'
import { store, getSecret } from '../store'
import { runChatContext } from '../chatContext'
import { queryAgentMemory } from '../agentMemory'
import { resolveModel } from '../modelRouter'
import { createWorktree, commitAll, push, createPr, removeWorktree, runGit } from '../gitOps'
import { appendEvent, readEvents } from '../agentEventLog'
import { setHandoff } from '../agentHandoffStore'
import { publish } from '../sessionRelay'
import { sendNotification } from '../ipc/notifications.handlers'
import { loadPolicy, checkCommand, checkPath, checkApproval, globToRegex } from '../policyEngine'
import { validateGeneratedTs } from '../codeValidator'
import { detectDeployCommand, runDeploy, providerFromCommand } from '../deploy'
import { appendDeployRecord } from '../deployHistory'
import * as path from 'path'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentProgress {
  sessionId: string
  planFile: string
  subtaskId: string
  subtaskDescription: string
  status:
    | 'running' | 'done' | 'retrying' | 'blocked' | 'finished' | 'error'
    | 'preparing' | 'finalizing' | 'pr-opened' | 'push-failed-kept-locally'
    | 'deploying' | 'deployed' | 'pending-approval' | 'approval-rejected'
    | 'edit-applied' | 'run-executed' | 'browse-executed'
    | 'stealing' | 'spawned-child'
  output?: string
  error?: string
  doneCount: number
  totalCount: number
  /** Set on 'pr-opened' (and any later status once known). */
  prUrl?: string
  /** Set on 'deployed' if the deploy tool printed a URL. */
  deployUrl?: string
  /** Branch the agent is working on, set once isolation is set up. */
  branch?: string
  /** Gap 142 — number of failed attempts so far on the current subtask (0-indexed). Set on 'retrying'. */
  retryCount?: number
  /** Gap 142 — retry budget for the current subtask. Set alongside retryCount. */
  maxRetries?: number
  /** Gap 138 — path edited, set on 'edit-applied'. */
  editPath?: string
  /** Gap 138 — command executed, set on 'run-executed'. */
  runCommand?: string
  /** Gap 138 — URL browsed, set on 'browse-executed'. */
  browseUrl?: string
  /** Swarm — role of the agent handling this subtask (frontend/backend/security/test/docs). */
  role?: string
  /** Governance — role of the approver (from .lakooraapprovers.json). */
  approverRole?: string
  /** Swarm — set on a child session's earliest events if it was spawned by another session. */
  parentSessionId?: string
}

interface Subtask {
  id: string
  description: string
  depends_on: string[]
  done: boolean
  role?: string
}

interface TaskPlanDetail {
  goal: string
  slug: string
  subtasks: Subtask[]
}

interface EditBlock {
  path: string
  content: string
}

interface RunBlock {
  command: string
}

interface BrowseBlock {
  url: string
  task: string
}

// ── Block parsers (mirrored from renderer/src/lib/editBlocks.ts) ──────────────

const EDIT_RE = /<<<EDIT ([^\n>]+)>>>\n([\s\S]*?)\n<<<END_EDIT>>>/g
const RUN_RE = /<<<RUN>>>\n([\s\S]*?)\n<<<END_RUN>>>/g
const BROWSE_RE = /<<<BROWSE ([^\n>]+)>>>\n([\s\S]*?)\n<<<END_BROWSE>>>/g
const HANDOFF_RE = /<<<HANDOFF key="([^"]+)">>>\n([\s\S]*?)\n<<<END_HANDOFF>>>/g
const SPAWN_RE = /<<<SPAWN goal="([^"]+)">>>\n([\s\S]*?)\n<<<END_SPAWN>>>/g

function parseEdits(text: string): EditBlock[] {
  return [...text.matchAll(EDIT_RE)].map((m) => ({ path: m[1].trim(), content: m[2] }))
}

function parseRuns(text: string): RunBlock[] {
  return [...text.matchAll(RUN_RE)].map((m) => ({ command: m[1].trim() }))
}

function parseBrowses(text: string): BrowseBlock[] {
  return [...text.matchAll(BROWSE_RE)].map((m) => ({ url: m[1].trim(), task: m[2].trim() }))
}

function parseSpawns(text: string): Array<{ goal: string; context: string }> {
  return [...text.matchAll(SPAWN_RE)].map((m) => ({ goal: m[1].trim(), context: m[2].trim() }))
}

// ── Safety blocklist (same as MAIN_BLOCKED in settings.handlers.ts) ──────────

const BLOCKED = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(\/|~|\$HOME|\$\{HOME\})/i,
  /:\(\)\s*\{\s*:|:\s*&\s*\}/,
  /dd\s+if=\/dev\/zero\s+of=\/dev\//i,
  /\bmkfs\b/i,
]

function isBlocked(cmd: string): boolean {
  return BLOCKED.some((re) => re.test(cmd))
}

// ── Active session registry ───────────────────────────────────────────────────

const MAX_CONCURRENT_SESSIONS = 3
const activeSessions = new Map<string, {
  sessionId: string
  abort: () => void
  planFile: string
  /** Worktree (or live projectPath fallback) this session's edits land in — set once isolation is set up, used by work-stealing to apply stolen edits to the *owning* session's tree. */
  worktreePath: string
  branch: string
}>()

// ── Swarm: cross-session subtask claims + per-plan-file write lock ───────────
// Work-stealing lets an idle session execute a pending subtask that belongs to
// another active session's plan. Both the owning session's own loop and any
// helper stealing from it pick subtasks from the same persisted plan file, so
// a shared claim set prevents the two from ever picking the same subtask id,
// and a per-plan-file lock serializes their `--done` writes (the Python CLI
// does a read-modify-write over the whole plan.json — without the lock, two
// concurrent markDone calls for *different* subtask ids in the *same* plan
// could race and silently drop one of them).

const claimedSubtasks = new Set<string>() // `${planFile}::${subtaskId}`

function tryClaimSubtask(planFile: string, subtaskId: string): boolean {
  const key = `${planFile}::${subtaskId}`
  if (claimedSubtasks.has(key)) return false
  claimedSubtasks.add(key)
  return true
}

function releaseSubtaskClaim(planFile: string, subtaskId: string): void {
  claimedSubtasks.delete(`${planFile}::${subtaskId}`)
}

const planFileLocks = new Map<string, Promise<unknown>>()

function withPlanLock<T>(planFile: string, fn: () => Promise<T>): Promise<T> {
  const prior = planFileLocks.get(planFile) ?? Promise.resolve()
  const next = prior.then(fn, fn)
  planFileLocks.set(planFile, next.catch(() => undefined))
  return next
}

// ── Governance approval gate (Gap 57) ─────────────────────────────────────────
// Only one agent session runs at a time, so a single module-level slot (rather
// than a map) is enough to track the one outstanding approval request.

interface ApprovalResult {
  approved: boolean
  /** OS username of whoever clicked Approve/Reject (Gap 61) — there's no separate login system in this single-user app. */
  approver: string
}

let pendingApproval: { sessionId: string; resolve: (result: ApprovalResult) => void } | null = null

function requestApproval(sessionId: string, timeoutMs?: number): Promise<ApprovalResult> {
  return new Promise<ApprovalResult>((resolve) => {
    pendingApproval = { sessionId, resolve }
    if (timeoutMs && timeoutMs > 0) {
      setTimeout(() => {
        if (pendingApproval?.sessionId === sessionId) {
          pendingApproval.resolve({ approved: false, approver: 'timeout' })
          pendingApproval = null
        }
      }, timeoutMs)
    }
  })
}

/** Looks up a username in .lakooraapprovers.json at projectPath. Returns the role string or null. */
async function lookupApproverRole(projectPath: string, username: string): Promise<string | null> {
  try {
    const { promises: fsp } = await import('fs')
    const raw = await fsp.readFile(path.join(projectPath, '.lakooraapprovers.json'), 'utf-8')
    const map = JSON.parse(raw) as Record<string, string>
    return map[username] ?? null
  } catch {
    return null
  }
}

/** Called from the IPC handler when the user clicks Approve/Reject. Returns false if there's no matching pending request. */
export function resolveApproval(sessionId: string, approved: boolean, approver: string): boolean {
  if (!pendingApproval || pendingApproval.sessionId !== sessionId) return false
  pendingApproval.resolve({ approved, approver })
  pendingApproval = null
  return true
}

// ── Progress broadcast ────────────────────────────────────────────────────────

export function broadcast(progress: AgentProgress): void {
  appendEvent(progress.sessionId, progress as unknown as Record<string, unknown>)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('agent:progress', progress)
  }
  publish(progress.sessionId, progress as unknown as Record<string, unknown>)
}

// ── Per-subtask repo context (Gap 28) ────────────────────────────────────────

/** Builds repo orientation relevant to one subtask, formatted for the agent's system prompt. */
async function getSubtaskContext(query: string, repoRootPath: string): Promise<string> {
  const results = await runChatContext(query, repoRootPath)
  if (!results.length) return ''
  const blocks = results.map((r) => {
    let block = `${r.file} — ${r.line}\n\`\`\`\n${r.snippet}\n\`\`\``
    const decisionNotes = r.related_decisions.map((d) => `_Related decision: "${d.task}" → ${d.verdict}_`)
    if (decisionNotes.length) block = `${block}\n${decisionNotes.join('\n')}`
    if (r.callers.length) {
      const sites = r.callers.map((c) => `${c.file}:${c.line}`).join(', ')
      block = `${block}\n_Called from ${r.callers.length} other places: ${sites}_`
    }
    return block
  })
  return `## Relevant codebase context\n\n${blocks.join('\n\n')}`
}

// ── Per-subtask agent memory (Gap 34) ────────────────────────────────────────

/** Surfaces persisted decision/preference memory relevant to one subtask. */
async function getSubtaskMemory(query: string): Promise<string> {
  const entries = await queryAgentMemory(query)
  if (!entries.length) return ''
  const blocks = entries.map((m) => `**${m.key}**${m.tags.length ? ` [${m.tags.join(', ')}]` : ''}\n${m.content}`)
  return `## Relevant past learnings\n\n${blocks.join('\n\n')}`
}

// ── Test output parser ────────────────────────────────────────────────────────

const TEST_RUNNER_RE = /\b(pytest|jest|vitest|go test|npm test|npm run test|cargo test)\b/

/** Returns a one-line structured summary from known test runner output formats, or null if unrecognised. */
function parseTestSummary(output: string): string | null {
  // pytest: "3 passed, 1 failed, 2 warnings in 0.12s"
  const pytestMatch = output.match(/(\d+ passed[^.\n]*(?:, \d+ failed)?[^\n.]*)/m)
  if (pytestMatch) return pytestMatch[1].trim()
  // jest/vitest: "Tests: 1 failed, 5 passed, 6 total"
  const jestMatch = output.match(/(Tests?:\s+\d+[^\n]+)/m)
  if (jestMatch) return jestMatch[1].trim()
  // go test: "FAIL github.com/foo/bar (0.12s)"
  const goMatch = output.match(/(FAIL\s+\S+[^\n]+)/m)
  if (goMatch) return goMatch[1].trim()
  // cargo test: "test result: FAILED. 1 passed; 2 failed;"
  const cargoMatch = output.match(/(test result:[^\n]+)/m)
  if (cargoMatch) return cargoMatch[1].trim()
  return null
}

// ── Working-tree diff context (Gap 43) ───────────────────────────────────────

/**
 * Returns a "## Changes so far" block showing what the agent has already written
 * in the worktree during this session. Uses `git diff --stat HEAD` when there is
 * at least one commit (i.e. after the first subtask commits something), falling
 * back to `git diff --stat` for uncommitted working-tree changes. Returns empty
 * string if the worktree has no changes yet or git is unavailable.
 */
async function getWorktreeDiff(worktreePath: string): Promise<string> {
  try {
    let stat = await runGit(worktreePath, ['diff', '--stat', 'HEAD']).catch(() => '')
    if (!stat.trim()) {
      stat = await runGit(worktreePath, ['diff', '--stat']).catch(() => '')
    }
    if (!stat.trim()) return ''
    return `## Changes written so far in this session\n\n\`\`\`\n${stat.trim()}\n\`\`\``
  } catch {
    return ''
  }
}

// ── Secrets guard (Gap 44) ────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'AWS access key',     re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub PAT',         re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'PEM private key',    re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'generic API secret', re: /(?:api[_-]?key|api[_-]?secret|password|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9+/]{24,}['"]/i },
]

/**
 * Returns the name of the first secret pattern found in `content`, or null.
 * Only called in the autonomous agent's edit path — not in the chat path.
 */
function detectSecret(content: string): string | null {
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(content)) return name
  }
  return null
}

// ── AI streaming helper ───────────────────────────────────────────────────────

export async function streamToString(
  messages: Array<{ role: string; content: string }>,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  let result = ''

  if (model.startsWith('claude')) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const apiKey = getSecret('anthropicApiKey')
    if (!apiKey) throw new Error('Anthropic API key not configured')
    const client = new Anthropic({ apiKey })
    const systemMessage = messages.find((m) => m.role === 'system')
    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      messages: messages.filter((m) => m.role !== 'system').map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })
    for await (const chunk of stream) {
      if (signal.aborted) break
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        result += chunk.delta.text
      }
    }
    return result
  }

  if (model.startsWith('gpt')) {
    const { default: OpenAI } = await import('openai')
    const apiKey = getSecret('openaiApiKey')
    if (!apiKey) throw new Error('OpenAI API key not configured')
    const client = new OpenAI({ apiKey })
    const stream = await client.chat.completions.create({
      model,
      messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
      stream: true,
    })
    for await (const chunk of stream) {
      if (signal.aborted) break
      result += chunk.choices[0]?.delta?.content ?? ''
    }
    return result
  }

  // Ollama
  const ollamaUrl = (store.get('ollamaUrl') as string | undefined) ?? 'http://localhost:11434'
  const resp = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  })
  const reader = resp.body?.getReader()
  if (!reader) throw new Error('No response body from Ollama')
  const dec = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done || signal.aborted) break
      for (const line of dec.decode(value).split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          result += obj.message?.content ?? ''
        } catch { /* partial line */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return result
}

// ── Apply an EDIT block to disk ───────────────────────────────────────────────

async function applyEdit(block: EditBlock, projectPath: string): Promise<void> {
  const absPath = block.path.startsWith('/') ? block.path : path.join(projectPath, block.path)
  const { promises: fs } = await import('fs')
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, block.content, 'utf-8')
}

// ── Execute a BROWSE block via Python (src.browser_context) ─────────────────

async function executeBrowse(block: BrowseBlock): Promise<{ success: boolean; result: string }> {
  const res = await runPythonJson(['-m', 'src.browser_context', '--url', block.url, '--task', block.task, '--json'])
  if (!res.ok) return { success: false, result: res.error ?? 'browser_context failed to start' }
  const stats = res.stats as { result: string; success: boolean }
  return { success: stats.success, result: stats.result }
}

// ── Mark a subtask done via Python ───────────────────────────────────────────

async function markDone(planFile: string, subtaskId: string): Promise<void> {
  await runPythonJson(['-m', 'src.task_planner', '--done', planFile, subtaskId, '--json'])
}

// ── Load plan ─────────────────────────────────────────────────────────────────

async function loadPlan(planFile: string): Promise<TaskPlanDetail | null> {
  const result = await runPythonJson(['-m', 'src.task_planner', '--show', planFile, '--json'])
  return result.ok ? (result.stats as TaskPlanDetail) : null
}

// ── Deployment detection + run ────────────────────────────────────────────────

async function attemptDeploy(opts: {
  sessionId: string
  planFile: string
  doneCount: number
  totalCount: number
  branch: string
  prUrl: string
  worktreePath: string
}): Promise<void> {
  const { sessionId, planFile, doneCount, totalCount, branch, prUrl, worktreePath } = opts

  const deployCmd = await detectDeployCommand(worktreePath)
  if (!deployCmd) return

  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: `Running ${deployCmd}…`, status: 'deploying', doneCount, totalCount, branch, prUrl })

  const provider = providerFromCommand(deployCmd)
  try {
    const { exitCode, deployUrl } = await runDeploy(worktreePath, deployCmd)
    // runDeploy never throws on a failing command — it returns a non-zero
    // exitCode instead — so this branch was previously unreachable and every
    // failed agent-triggered deploy was broadcast as 'deployed' regardless.
    if (exitCode !== 0) {
      broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'error', error: `Deploy command exited with code ${exitCode}`, doneCount, totalCount, branch, prUrl })
      appendDeployRecord(worktreePath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target: 'production', exitCode, url: undefined })
      return
    }
    broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'deployed', doneCount, totalCount, branch, prUrl, deployUrl })
    appendDeployRecord(worktreePath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target: 'production', exitCode, url: deployUrl })
  } catch { /* deploy failed — not fatal, session already succeeded */ }
}

// ── Verification report (Gap 53) ──────────────────────────────────────────────

/**
 * Writes a Markdown "evidence" report to <projectPath>/.lakoora/reports/<sessionId>.md
 * summarizing the session: subtask completion, policy/error events pulled from the
 * persisted event log, and the final PR link if one was opened. Generated regardless
 * of whether the session fully succeeded — an audit trail is most useful precisely
 * when something was blocked or failed.
 */
async function writeVerificationReport(opts: {
  sessionId: string
  projectPath: string
  plan: TaskPlanDetail
  branch: string
  doneCount: number
  totalCount: number
  prUrl: string | null
}): Promise<void> {
  const { sessionId, projectPath, plan, branch, doneCount, totalCount, prUrl } = opts
  const events = readEvents(sessionId)
  const blocked = events.filter((e) => e.status === 'blocked')
  const errors = events.filter((e) => e.status === 'error')
  const approvals = events.filter((e) => e.status === 'pending-approval' || e.status === 'approval-rejected' || /\(approved by /.test(String(e.subtaskDescription ?? '')))

  const lines: string[] = []
  lines.push(`# Agent Session Report: ${plan.goal}`)
  lines.push('')
  lines.push(`- Session: ${sessionId}`)
  lines.push(`- Branch: ${branch}`)
  lines.push(`- Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`## Subtasks (${doneCount}/${totalCount} done)`)
  lines.push('')
  for (const s of plan.subtasks) {
    lines.push(`- [${s.done ? 'x' : ' '}] [${s.id}] ${s.description}`)
  }
  lines.push('')
  lines.push('## Policy Evaluations')
  lines.push('')
  lines.push(blocked.length === 0
    ? 'No policy or safety violations recorded.'
    : blocked.map((e) => `- BLOCKED [${e.subtaskId}]: ${e.error}`).join('\n'))
  lines.push('')
  lines.push('## Errors')
  lines.push('')
  lines.push(errors.length === 0
    ? 'No errors recorded.'
    : errors.map((e) => `- ERROR [${e.subtaskId}]: ${e.error}`).join('\n'))
  lines.push('')
  lines.push('## Approvals')
  lines.push('')
  lines.push(approvals.length === 0
    ? 'No governance approval requests recorded.'
    : approvals.map((e) => {
        if (e.status === 'pending-approval') return `- REQUESTED [${e.subtaskId}]: ${e.error}`
        if (e.status === 'approval-rejected') return `- REJECTED [${e.subtaskId}]: ${e.error}`
        return `- ${e.subtaskDescription}`
      }).join('\n'))
  lines.push('')
  lines.push('## Actions taken')
  lines.push('')
  const editsApplied = events.filter((e) => e.status === 'edit-applied')
  const runsExecuted = events.filter((e) => e.status === 'run-executed')
  const browsesExecuted = events.filter((e) => e.status === 'browse-executed')
  if (editsApplied.length === 0 && runsExecuted.length === 0 && browsesExecuted.length === 0) {
    lines.push('No actions recorded.')
  } else {
    for (const e of editsApplied) lines.push(`- [${e.subtaskId}] Edited \`${e.editPath}\``)
    for (const e of runsExecuted) lines.push(`- [${e.subtaskId}] Ran: \`${e.runCommand}\``)
    for (const e of browsesExecuted) lines.push(`- [${e.subtaskId}] Browsed: ${e.browseUrl}`)
    lines.push('')
    lines.push('_File-level diffs available via "View diff" in Agent panel — this list shows paths only._')
  }
  lines.push('')
  lines.push('## Pull Request')
  lines.push('')
  lines.push(prUrl ?? 'No PR opened.')
  lines.push('')

  try {
    const { promises: fsp } = await import('fs')
    const reportDir = path.join(projectPath, '.lakoora', 'reports')
    await fsp.mkdir(reportDir, { recursive: true })
    await fsp.writeFile(path.join(reportDir, `${sessionId}.md`), lines.join('\n'))
  } catch {
    // Report generation must never fail the session.
  }

  // Gap 71 — write an ADR-style decision log entry so the Decisions audit panel
  // gets an automatic entry for every completed autonomous agent session.
  const rejectedByApprover = events.some((e) => e.status === 'approval-rejected')
  const verdict = rejectedByApprover
    ? 'Rejected'
    : errors.length > 0
      ? 'Completed with errors'
      : prUrl
        ? 'LGTM'
        : 'Completed'
  const outcome = prUrl
    ? `Completed ${doneCount}/${totalCount} subtasks; PR: ${prUrl}`
    : `Completed ${doneCount}/${totalCount} subtasks on branch ${branch}`
  const findings: string[] = [
    ...blocked.map((e) => `Policy block: ${e.error ?? e.subtaskId}`),
    ...errors.map((e) => `Error: ${e.error ?? e.subtaskId}`),
  ]
  const decisionArgs = [
    '-m', 'src.decision_log', '--log',
    '--task', plan.goal,
    '--verdict', verdict,
    '--outcome', outcome,
    '--agent', 'lakoora-agent',
    '--retries', String(events.filter((e) => e.status === 'error').length),
    '--dir', path.join(projectPath, 'docs', 'decisions'),
    ...findings.flatMap((f) => ['--finding', f]),
  ]
  runPythonJson(decisionArgs).catch(() => {
    // Decision log is best-effort — never fail the session.
  })
}

// ── Finalize step (commit → push → PR → deploy → cleanup) ────────────────────

async function finalizeSession(opts: {
  sessionId: string
  planFile: string
  plan: TaskPlanDetail
  projectPath: string
  worktreePath: string
  branch: string
  doneCount: number
}): Promise<void> {
  const { sessionId, planFile, plan, projectPath, worktreePath, branch, doneCount } = opts
  const totalCount = plan.subtasks.length

  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: 'Committing changes…', status: 'finalizing', doneCount, totalCount, branch })

  const { committed } = await commitAll(worktreePath, `Agent: ${plan.goal}`)
  if (!committed) {
    await removeWorktree(projectPath, worktreePath).catch(() => {})
    await writeVerificationReport({ sessionId, projectPath, plan, branch, doneCount, totalCount, prUrl: null })
    broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'finished', doneCount, totalCount })
    return
  }

  // Push
  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: `Pushing branch ${branch}…`, status: 'finalizing', doneCount, totalCount, branch })
  try {
    await push(worktreePath, branch)
  } catch (err) {
    await writeVerificationReport({ sessionId, projectPath, plan, branch, doneCount, totalCount, prUrl: null })
    broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: `Branch ${branch} exists locally only (push failed: ${err})`, status: 'push-failed-kept-locally', doneCount, totalCount, branch })
    return
  }

  // Create PR
  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: 'Opening PR…', status: 'finalizing', doneCount, totalCount, branch })
  const base = await runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main')
  const prUrl = await createPr(worktreePath, {
    title: `Agent: ${plan.goal}`,
    body: `Automated changes by Lakoora autonomous agent.\n\nGoal: ${plan.goal}`,
    base,
    head: branch,
  })

  if (!prUrl) {
    await writeVerificationReport({ sessionId, projectPath, plan, branch, doneCount, totalCount, prUrl: null })
    broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: `Branch ${branch} pushed but PR creation failed (no gh or not authenticated)`, status: 'push-failed-kept-locally', doneCount, totalCount, branch })
    return
  }

  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'pr-opened', doneCount, totalCount, branch, prUrl })

  // Attempt deployment (before cleanup — deploy runs against the worktree state)
  await attemptDeploy({ sessionId, planFile, doneCount, totalCount, branch, prUrl, worktreePath })

  // Cleanup only on full success (pushed + PR opened)
  await removeWorktree(projectPath, worktreePath, true).catch(() => {})

  await writeVerificationReport({ sessionId, projectPath, plan, branch, doneCount, totalCount, prUrl })

  sendNotification(`[Lakoora] Agent session ${sessionId.slice(0, 8)} finished — ${doneCount}/${totalCount} subtasks${prUrl ? `. PR: ${prUrl}` : ''}`)
  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'finished', doneCount, totalCount, branch, prUrl })
}

// ── Main orchestration loop ───────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are an autonomous coding agent running inside the Lakoora IDE.
You receive one subtask at a time from a task plan. Implement it completely.

To write files use:
<<<EDIT relative/path/to/file.ext>>>
...full file content...
<<<END_EDIT>>>

To run a shell command use:
<<<RUN>>>
command here
<<<END_RUN>>>

To look something up or perform an action on a live webpage use:
<<<BROWSE https://example.com/page>>>
description of what to do or extract on that page
<<<END_BROWSE>>>

To delegate an independent, self-contained piece of work to a brand-new autonomous
agent session (its own plan, worktree, and branch) rather than doing it yourself, use:
<<<SPAWN goal="short goal for the child agent">>>
optional extra context for the child agent
<<<END_SPAWN>>>
Only spawn when the work is genuinely separable from your current subtask — most
subtasks should just be implemented directly.

Only one command per RUN block, one URL per BROWSE block. After your implementation, briefly summarise what you did.`

// ── Swarm: role auto-classifier + role-specific system prompt preambles ──────

function classifySubtaskRole(description: string): string {
  const d = description.toLowerCase()
  if (/test|spec|jest|vitest|pytest|coverage|assert/.test(d)) return 'test'
  if (/security|vuln|injection|xss|auth|rbac|permission|cve/.test(d)) return 'security'
  if (/readme|doc|comment|jsdoc|docstring|changelog/.test(d)) return 'docs'
  if (/component|react|css|tailwind|ui|layout|style|frontend|a11y/.test(d)) return 'frontend'
  if (/api|route|endpoint|database|schema|migration|backend|server/.test(d)) return 'backend'
  return ''
}

const ROLE_PREAMBLES: Record<string, string> = {
  frontend: 'You are specialised as a FRONTEND agent. Focus on React components, CSS-in-JS, accessibility, and responsive layout. Prefer small single-responsibility components. Do not change backend API contracts.',
  backend: 'You are specialised as a BACKEND agent. Focus on API design, database schemas, error handling, and performance. Do not touch frontend components unless explicitly required.',
  security: 'You are specialised as a SECURITY REVIEWER agent. Your role is READ-ONLY code review — do NOT produce <<<EDIT>>> blocks. Scan the codebase for injection vulnerabilities, authentication flaws, secret exposure, and insecure defaults. Report every finding as a <<<REVIEW>>> block containing a JSON array: [{\"finding\": \"description\", \"severity\": \"low|medium|high|critical\", \"line\": 0}].',
  test: 'You are specialised as a TEST agent. Write comprehensive tests for the described functionality. Run them with <<<RUN>>> blocks to verify they pass before considering the subtask done.',
  docs: 'You are specialised as a DOCUMENTATION agent. Update README files, docstrings, and API documentation to match the current implementation. Do not change logic or application code.',
}

// ── Swarm: dynamic task rebalancing (work stealing) ───────────────────────────
// When a session runs out of its own pending subtasks, it looks for unclaimed
// pending work in *other* active sessions' plans and executes one subtask of
// theirs directly in their worktree, rather than sitting idle while siblings
// still have a backlog. Anything that would need the owning session's retry
// budget or governance approval is abandoned (claim released, no markDone) —
// stealing only ever picks off the "easy" work; risky subtasks are left for
// the owning session's own full pipeline.

async function claimStealableSubtask(
  ownSessionId: string,
  ownPlanFile: string,
): Promise<{
  owningSessionId: string
  planFile: string
  targetPath: string
  branch: string
  subtask: Subtask
  doneCount: number
  totalCount: number
} | null> {
  for (const [otherSessionId, session] of activeSessions) {
    // Skip ourselves, sessions on our own plan, and sessions still mid-setup
    // (worktreePath is only populated once isolation finishes — see startAutonomousSession).
    if (otherSessionId === ownSessionId || session.planFile === ownPlanFile || !session.worktreePath) continue
    const plan = await loadPlan(session.planFile)
    if (!plan) continue
    const doneCount = plan.subtasks.filter((s) => s.done).length
    const totalCount = plan.subtasks.length
    for (const subtask of plan.subtasks) {
      if (subtask.done) continue
      const depsUnmet = subtask.depends_on.some((depId) => !plan.subtasks.find((s) => s.id === depId)?.done)
      if (depsUnmet) continue
      if (!tryClaimSubtask(session.planFile, subtask.id)) continue
      return { owningSessionId: otherSessionId, planFile: session.planFile, targetPath: session.worktreePath, branch: session.branch, subtask, doneCount, totalCount }
    }
  }
  return null
}

async function runStolenSubtask(opts: {
  helperSessionId: string
  helperPlanFile: string
  helperBranch: string
  helperDoneCount: number
  helperTotalCount: number
  owningSessionId: string
  owningBranch: string
  targetPlanFile: string
  targetPath: string
  subtask: Subtask
  doneCount: number
  totalCount: number
  policy: ReturnType<typeof loadPolicy>
  model: string
  signal: AbortSignal
}): Promise<void> {
  const {
    helperSessionId, helperPlanFile, helperBranch, helperDoneCount, helperTotalCount,
    owningSessionId, owningBranch, targetPlanFile, targetPath, subtask, doneCount, totalCount, policy, model, signal,
  } = opts

  try {
    broadcast({
      sessionId: helperSessionId, planFile: helperPlanFile, subtaskId: subtask.id,
      subtaskDescription: `Helping session ${owningSessionId.slice(0, 8)}: ${subtask.description}`,
      status: 'stealing', doneCount: helperDoneCount, totalCount: helperTotalCount, branch: helperBranch || undefined,
    })

    const effectiveRole = subtask.role || classifySubtaskRole(subtask.description)
    const rolePreamble = effectiveRole ? (ROLE_PREAMBLES[effectiveRole] ?? '') : ''
    const systemPrompt = rolePreamble
      ? `${AGENT_SYSTEM_PROMPT}\n\n# Agent Role: ${effectiveRole}\n${rolePreamble}`
      : AGENT_SYSTEM_PROMPT

    let response: string
    try {
      response = await streamToString(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: subtask.description }],
        resolveModel(model, subtask.description),
        signal,
      )
    } catch {
      return
    }
    if (signal.aborted) return

    broadcast({
      sessionId: owningSessionId, planFile: targetPlanFile, subtaskId: subtask.id,
      subtaskDescription: subtask.description, status: 'running', doneCount, totalCount,
      branch: owningBranch || undefined, role: effectiveRole || undefined,
    })

    for (const edit of parseEdits(response)) {
      if (detectSecret(edit.content)) return
      if (checkPath(policy, edit.path)) return
      if (policy.max_edit_lines && edit.content.split('\n').length > policy.max_edit_lines) return
      if (policy.require_type_check && (edit.path.endsWith('.ts') || edit.path.endsWith('.tsx'))) {
        const absPath = edit.path.startsWith('/') ? edit.path : path.join(targetPath, edit.path)
        if (await validateGeneratedTs(edit.content, absPath)) return
      }
      try {
        await applyEdit(edit, targetPath)
        broadcast({ sessionId: owningSessionId, planFile: targetPlanFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'edit-applied', editPath: edit.path, doneCount, totalCount })
      } catch {
        return
      }
    }

    for (const run of parseRuns(response)) {
      // Anything blocked, policy-flagged, or needing approval is left for the
      // owning session's own pipeline — work-stealing never requests approval.
      if (isBlocked(run.command) || checkCommand(policy, run.command) || checkApproval(policy, run.command)) return
      try {
        const result = await runCommand('/bin/sh', ['-c', run.command], targetPath)
        if (result.exitCode !== 0) return
        broadcast({ sessionId: owningSessionId, planFile: targetPlanFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'run-executed', runCommand: run.command, doneCount, totalCount })
      } catch {
        return
      }
    }

    for (const browse of parseBrowses(response)) {
      const { success } = await executeBrowse(browse)
      if (!success) return
      broadcast({ sessionId: owningSessionId, planFile: targetPlanFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'browse-executed', browseUrl: browse.url, doneCount, totalCount })
    }

    for (const [, key, value] of response.matchAll(HANDOFF_RE)) setHandoff(key, value.trim())

    await withPlanLock(targetPlanFile, () => markDone(targetPlanFile, subtask.id))
    broadcast({
      sessionId: owningSessionId, planFile: targetPlanFile, subtaskId: subtask.id,
      subtaskDescription: `${subtask.description} (completed via work-stealing by session ${helperSessionId.slice(0, 8)})`,
      status: 'done', output: response.slice(0, 500), doneCount: doneCount + 1, totalCount, branch: owningBranch || undefined,
    })
  } finally {
    releaseSubtaskClaim(targetPlanFile, subtask.id)
  }
}

// ── Swarm: agent-to-agent spawning ────────────────────────────────────────────
// A subtask's AI response may delegate an independent sub-goal to a brand-new
// autonomous session via a <<<SPAWN goal="...">>> block. The child gets its own
// plan file, worktree, and branch — fully independent of the parent — and the
// parent (or the user, via @handoff:spawn:<sessionId>) can look up the child's
// session id once it's been kicked off.

async function spawnChildSession(
  parentSessionId: string,
  parentPlanFile: string,
  spawn: { goal: string; context: string },
  model: string,
  doneCount: number,
  totalCount: number,
): Promise<void> {
  const goal = spawn.context ? `${spawn.goal}\n\nContext from parent agent:\n${spawn.context}` : spawn.goal
  const result = await runPythonJson(['-m', 'src.task_planner', '--new', goal, '--save'])
  if (!result.ok) {
    setHandoff(`spawn-failed:${parentSessionId}`, `${spawn.goal} — failed to create plan: ${result.error}`)
    return
  }
  const planDetail = result.stats as TaskPlanDetail
  const childPlanFile = `plans/${planDetail.slug}.json`

  try {
    const childSessionId = await startAutonomousSession({ planFile: childPlanFile, model, parentSessionId })
    setHandoff(`spawn:${parentSessionId}`, childSessionId)
    broadcast({
      sessionId: parentSessionId, planFile: parentPlanFile, subtaskId: '',
      subtaskDescription: `Spawned child session ${childSessionId.slice(0, 8)} for: ${spawn.goal}`,
      status: 'spawned-child', doneCount, totalCount,
    })
  } catch (err) {
    setHandoff(`spawn-failed:${parentSessionId}`, `${spawn.goal} (plan: ${childPlanFile}) — ${err}`)
  }
}

export async function startAutonomousSession(opts: {
  planFile: string
  model: string
  /** Swarm — set when this session was spawned by another via a <<<SPAWN>>> block. */
  parentSessionId?: string
}): Promise<string> {
  if (activeSessions.size >= MAX_CONCURRENT_SESSIONS)
    throw new Error(`Max ${MAX_CONCURRENT_SESSIONS} concurrent sessions — stop one first`)

  const sessionId = randomUUID()
  const controller = new AbortController()
  activeSessions.set(sessionId, { sessionId, abort: () => controller.abort(), planFile: opts.planFile, worktreePath: '', branch: '' })

  const { planFile, model, parentSessionId } = opts
  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()

  void (async () => {
    let worktreePath: string | null = null
    let activePath = projectPath
    let agentBranch = ''
    // Tracks the subtask id this session is currently claimed on, across
    // retries of the same subtask — released in the outer `finally` below on
    // any exit path (abort, error, blocked, approval-rejected, or completion).
    let currentSubtaskId = ''

    try {
      // Initial plan load to get the goal for the branch name
      const initialPlan = await loadPlan(planFile)
      if (!initialPlan) {
        broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'error', error: 'Failed to load plan', doneCount: 0, totalCount: 0 })
        return
      }

      // Set up worktree isolation
      const slug = initialPlan.goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
      const shortId = randomUUID().slice(0, 8)
      agentBranch = `agent/${slug}-${shortId}`
      const candidateWorktreePath = path.join(projectPath, '.lakoora-worktrees', agentBranch)

      broadcast({
        sessionId, planFile, subtaskId: '', subtaskDescription: `Setting up worktree on branch ${agentBranch}`,
        status: 'preparing', doneCount: 0, totalCount: initialPlan.subtasks.length, branch: agentBranch,
        parentSessionId,
      })

      try {
        await createWorktree(projectPath, candidateWorktreePath, agentBranch)
        worktreePath = candidateWorktreePath
        activePath = candidateWorktreePath
      } catch {
        // Not a git repo, or worktree creation failed — fall back to live working tree
        broadcast({
          sessionId, planFile, subtaskId: '', subtaskDescription: 'No git repo or worktree creation failed — using live working tree',
          status: 'preparing', doneCount: 0, totalCount: initialPlan.subtasks.length,
        })
      }

      // Gap 45 — inject global + project rules into the agent system prompt.
      // Fetched once at session start; a rules file change mid-session is ignored
      // intentionally (consistent within a session).
      const globalRules = (store.get('globalRules') as string | undefined) ?? ''
      const globalRulesBlock = globalRules.trim() ? `\n\n# Global Rules\n${globalRules.trim()}` : ''
      let projectRulesBlock = ''
      try {
        const { promises: fsp } = await import('fs')
        const rules = await fsp.readFile(path.join(projectPath, '.lakoorarules'), 'utf-8').catch(() => '')
        if (rules.trim()) projectRulesBlock = `\n\n# Project Rules (.lakoorarules)\n${rules.trim()}`
      } catch { /* no rules file */ }
      const agentSystemPrompt = AGENT_SYSTEM_PROMPT + globalRulesBlock + projectRulesBlock

      // Gap 52 — project-configurable policy (.lakoorapolicies.json), layered on
      // top of the hardcoded destructive-command blocklist (isBlocked above).
      const policy = loadPolicy(projectPath)

      // Record the resolved worktree/branch so other sessions can find this one
      // when work-stealing — must happen after isolation is set up above.
      activeSessions.set(sessionId, { sessionId, abort: () => controller.abort(), planFile, worktreePath: activePath, branch: agentBranch })

      let retryContext: string | null = null
      // Gap 142 — bounded retry budget per subtask. retryCount tracks completed
      // failed attempts (0-indexed); isRetry distinguishes "any attempt past the
      // first" for prompt/status purposes and is unaffected by the count itself.
      // max_retries is project-configurable via .lakoorapolicies.json (defaults to 3).
      let retryCount = 0
      const MAX_RETRIES = policy.max_retries
      // Cached per subtask id so a retry of the same subtask reuses the
      // already-fetched context block instead of re-querying chat_context.
      let cachedContextSubtaskId = ''
      let cachedContextBlock = ''
      let cachedMemoryBlock = ''
      let cachedDiffBlock = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (controller.signal.aborted) break

        const plan = await loadPlan(planFile)
        if (!plan) {
          broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'error', error: 'Failed to load plan', doneCount: 0, totalCount: 0 })
          break
        }

        const pending = plan.subtasks.filter((s) => !s.done)
        const doneCount = plan.subtasks.filter((s) => s.done).length
        const totalCount = plan.subtasks.length

        if (pending.length === 0) {
          // Gap: dynamic rebalancing — before finalizing, see if a sibling
          // session still has unclaimed pending work this idle session can help with.
          const stolen = await claimStealableSubtask(sessionId, planFile)
          if (stolen) {
            await runStolenSubtask({
              helperSessionId: sessionId, helperPlanFile: planFile, helperBranch: agentBranch,
              helperDoneCount: doneCount, helperTotalCount: totalCount,
              owningSessionId: stolen.owningSessionId, owningBranch: stolen.branch,
              targetPlanFile: stolen.planFile, targetPath: stolen.targetPath, subtask: stolen.subtask,
              doneCount: stolen.doneCount, totalCount: stolen.totalCount,
              policy, model, signal: controller.signal,
            })
            continue
          }
          if (worktreePath) {
            await finalizeSession({ sessionId, planFile, plan, projectPath, worktreePath, branch: agentBranch, doneCount })
          } else {
            await writeVerificationReport({ sessionId, projectPath, plan, branch: agentBranch, doneCount, totalCount, prUrl: null })
            broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'finished', doneCount, totalCount })
          }
          break
        }

        // Skip subtasks a work-stealing helper has already claimed elsewhere —
        // re-claiming our own in-flight subtask across a retry is a no-op.
        const subtask = pending.find((s) => s.id === currentSubtaskId) ?? pending.find((s) => tryClaimSubtask(planFile, s.id))
        if (!subtask) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
          continue
        }
        currentSubtaskId = subtask.id
        const effectiveRole = subtask.role || classifySubtaskRole(subtask.description)
        const isRetry = retryContext !== null

        broadcast({
          sessionId, planFile,
          subtaskId: subtask.id,
          subtaskDescription: subtask.description,
          status: isRetry ? 'retrying' : 'running',
          doneCount, totalCount,
          branch: agentBranch || undefined,
          role: effectiveRole || undefined,
          ...(isRetry ? { retryCount, maxRetries: MAX_RETRIES } : {}),
        })

        // Fetched once per subtask attempt cycle, not per retry — it goes in
        // the system prompt rather than userContent because userContent is
        // rebuilt on every retry (see isRetry below), so putting context there
        // would re-fetch and duplicate it on each retry of the same subtask.
        if (cachedContextSubtaskId !== subtask.id) {
          cachedContextSubtaskId = subtask.id
          cachedContextBlock = await getSubtaskContext(subtask.description, projectPath)
          cachedMemoryBlock = await getSubtaskMemory(subtask.description)
          cachedDiffBlock = worktreePath ? await getWorktreeDiff(worktreePath) : ''
        }
        const contextBlock = cachedContextBlock
        const memoryBlock = cachedMemoryBlock
        const diffBlock = cachedDiffBlock
        const rolePreamble = effectiveRole ? (ROLE_PREAMBLES[effectiveRole] ?? '') : ''
        const roleSystemPrompt = rolePreamble
          ? `${agentSystemPrompt}\n\n# Agent Role: ${effectiveRole}\n${rolePreamble}`
          : agentSystemPrompt
        const promptBlocks = [contextBlock, memoryBlock, diffBlock].filter(Boolean)
        const systemPrompt = promptBlocks.length
          ? `${roleSystemPrompt}\n\n${promptBlocks.join('\n\n')}`
          : roleSystemPrompt

        const userContent = isRetry
          ? `Previous attempt failed:\n${retryContext}\n\nRetry the same subtask:\n${subtask.description}`
          : subtask.description

        const resolvedModel = resolveModel(model, subtask.description)

        let response: string
        try {
          response = await streamToString(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            resolvedModel,
            controller.signal,
          )
        } catch (err) {
          broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'error', error: String(err), doneCount, totalCount })
          break
        }

        if (controller.signal.aborted) break

        // Apply edits — all edits go to activePath (worktree if set up, else projectPath)
        const edits = parseEdits(response)
        let editError: string | null = null
        for (const edit of edits) {
          const secretPattern = detectSecret(edit.content)
          if (secretPattern) {
            editError = `Edit blocked: content of ${edit.path} matches secret pattern "${secretPattern}"`
            break
          }
          const pathViolation = checkPath(policy, edit.path)
          if (pathViolation) {
            editError = `Edit blocked by policy: ${edit.path} matches blocked path pattern "${pathViolation.pattern}"`
            break
          }
          if (policy.max_edit_lines) {
            const lineCount = edit.content.split('\n').length
            if (lineCount > policy.max_edit_lines) {
              editError = `Edit blocked: ${edit.path} is ${lineCount} lines (policy max_edit_lines: ${policy.max_edit_lines})`
              break
            }
          }
          if (policy.require_type_check && (edit.path.endsWith('.ts') || edit.path.endsWith('.tsx'))) {
            const absPath = edit.path.startsWith('/') ? edit.path : path.join(activePath, edit.path)
            const tsError = await validateGeneratedTs(edit.content, absPath)
            if (tsError) {
              editError = `TypeScript validation failed for ${edit.path}:\n${tsError}`
              break
            }
          }
          if (policy.auto_review_paths?.length) {
            const needsReview = policy.auto_review_paths.some((glob) => globToRegex(glob).test(edit.path))
            if (needsReview) {
              try {
                const reviewResponse = await streamToString([
                  { role: 'system', content: 'You are a security code reviewer. Respond ONLY with a JSON object inside <<<REVIEW>>>\\n{...}\\n<<<END_REVIEW>>> delimiters. The JSON must have: "findings" (array of {severity,file,line?,message}) and "summary" (string). If no issues found, return an empty findings array.' },
                  { role: 'user', content: `Review this edit to ${edit.path} for security issues:\n\n${edit.content.slice(0, 4000)}` },
                ], model, controller.signal)
                broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'running', output: `Security review for ${edit.path}:\n${reviewResponse.slice(0, 500)}`, doneCount, totalCount })
              } catch { /* review failure does not block the edit */ }
            }
          }
          try {
            await applyEdit(edit, activePath)
            broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'edit-applied', editPath: edit.path, doneCount, totalCount })
          }
          catch (err) { editError = `Edit failed for ${edit.path}: ${err}`; break }
        }

        if (editError) {
          if (retryCount >= MAX_RETRIES) {
            broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'blocked', error: editError, doneCount, totalCount })
            break
          }
          retryContext = editError
          retryCount++
          continue
        }

        // Run commands — cwd is activePath (worktree if set up, else projectPath)
        const runs = parseRuns(response)
        let runError: string | null = null
        for (const run of runs) {
          if (isBlocked(run.command)) {
            runError = `Command blocked by safety policy: ${run.command}`
            break
          }
          const commandViolation = checkCommand(policy, run.command)
          if (commandViolation) {
            runError = `Command blocked by project policy: ${run.command} matches "${commandViolation.pattern}"`
            break
          }
          const approvalNeeded = checkApproval(policy, run.command)
          if (approvalNeeded) {
            broadcast({
              sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description,
              status: 'pending-approval', error: `Approval required: ${run.command} matches "${approvalNeeded.pattern}"`,
              doneCount, totalCount,
            })
            sendNotification(`[Lakoora] Agent session ${sessionId.slice(0, 8)} requires approval for: \`${run.command}\``)
            // Gap 78 — OS-level desktop notification so the user knows approval is needed
            // even when the IDE is in the background.
            const { Notification } = await import('electron')
            if (Notification.isSupported()) {
              new Notification({
                title: 'Lakoora — Approval Required',
                body: `Agent paused: "${run.command}" requires your approval.`,
              }).show()
            }
            const { approved, approver } = await requestApproval(
              sessionId,
              policy.approval_timeout_minutes ? policy.approval_timeout_minutes * 60_000 : undefined,
            )
            const approverRole = await lookupApproverRole(projectPath, approver)
            if (!approved) {
              broadcast({
                sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description,
                status: 'approval-rejected', error: `Rejected by ${approver}: ${run.command}`, doneCount, totalCount,
                approverRole: approverRole ?? undefined,
              })
              sendNotification(`[Lakoora] Agent session ${sessionId.slice(0, 8)} approval rejected by ${approver}${approverRole ? ` (${approverRole})` : ''}`)
              return // human rejection halts the session cleanly — no retry, worktree left intact for review
            }
            broadcast({
              sessionId, planFile, subtaskId: subtask.id,
              subtaskDescription: `${subtask.description} (approved by ${approver}${approverRole ? ` / ${approverRole}` : ''})`,
              status: 'running', doneCount, totalCount, approverRole: approverRole ?? undefined,
            })
          }
          try {
            const result = await runCommand('/bin/sh', ['-c', run.command], activePath)
            if (result.exitCode !== 0) {
              const isTestRun = TEST_RUNNER_RE.test(run.command)
              let failDetail: string
              if (isTestRun) {
                const combined = result.stdout + '\n' + result.stderr
                failDetail = parseTestSummary(combined) ?? combined.slice(0, 500)
              } else {
                failDetail = result.stderr || result.stdout
              }
              runError = `Command failed (exit ${result.exitCode}): ${run.command}\n${failDetail}`
              break
            }
            broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'run-executed', runCommand: run.command, doneCount, totalCount })
          } catch (err) {
            runError = `Command error: ${err}`
            break
          }
        }

        if (runError) {
          if (retryCount >= MAX_RETRIES) {
            broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'blocked', error: runError, doneCount, totalCount })
            break
          }
          retryContext = runError
          retryCount++
          continue
        }

        // Browse pages
        const browses = parseBrowses(response)
        let browseError: string | null = null
        for (const browse of browses) {
          const { success, result } = await executeBrowse(browse)
          if (!success) {
            browseError = `Browse failed for ${browse.url}: ${result}`
            break
          }
          broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'browse-executed', browseUrl: browse.url, doneCount, totalCount })
        }

        if (browseError) {
          if (retryCount >= MAX_RETRIES) {
            broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'blocked', error: browseError, doneCount, totalCount })
            break
          }
          retryContext = browseError
          retryCount++
          continue
        }

        // Extract handoff values from the response and store them for cross-agent access
        for (const [, key, value] of response.matchAll(HANDOFF_RE)) {
          setHandoff(key, value.trim())
        }

        // Delegate independent sub-goals to brand-new child sessions (fire-and-forget).
        for (const spawn of parseSpawns(response)) {
          void spawnChildSession(sessionId, planFile, spawn, model, doneCount, totalCount)
        }

        // Subtask succeeded
        await withPlanLock(planFile, () => markDone(planFile, subtask.id))
        currentSubtaskId = ''
        retryContext = null
        retryCount = 0
        broadcast({
          sessionId, planFile,
          subtaskId: subtask.id,
          subtaskDescription: subtask.description,
          status: 'done',
          output: response.slice(0, 500),
          doneCount: doneCount + 1,
          totalCount,
          branch: agentBranch || undefined,
        })
      }
    } finally {
      if (currentSubtaskId) releaseSubtaskClaim(planFile, currentSubtaskId)
      activeSessions.delete(sessionId)
    }
  })()

  return sessionId
}

export function stopAutonomousSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId)
  if (!session) return false
  session.abort()
  activeSessions.delete(sessionId)
  return true
}

export function getActiveSessions(): string[] {
  return [...activeSessions.keys()]
}

// ── On-demand test-fix loop (Gap 135 extension) ───────────────────────────────
// Separate from activeSessions/MAX_CONCURRENT_SESSIONS — a test-fix loop runs
// on the live working tree and doesn't count against the concurrent session cap.

let testFixSession: { sessionId: string; abort: () => void } | null = null

export async function runTestFixLoop(opts: { command: string; model: string }): Promise<string> {
  if (testFixSession) {
    testFixSession.abort()
    testFixSession = null
  }

  const sessionId = randomUUID()
  const controller = new AbortController()
  testFixSession = { sessionId, abort: () => controller.abort() }

  const planFile = ''
  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()
  const policy = loadPolicy(projectPath)
  const MAX_RETRIES = policy.max_retries

  void (async () => {
    try {
      broadcast({ sessionId, planFile, subtaskId: 'test-fix', subtaskDescription: `Running: ${opts.command}`, status: 'running', doneCount: 0, totalCount: MAX_RETRIES })
      let retryCount = 0
      while (retryCount <= MAX_RETRIES) {
        if (controller.signal.aborted) break
        const result = await runCommand('/bin/sh', ['-c', opts.command], projectPath)
        if (result.exitCode === 0) {
          broadcast({ sessionId, planFile, subtaskId: 'test-fix', subtaskDescription: 'All tests pass', status: 'done', doneCount: MAX_RETRIES, totalCount: MAX_RETRIES })
          return
        }
        if (retryCount >= MAX_RETRIES) break
        const combined = result.stdout + '\n' + result.stderr
        const summary = parseTestSummary(combined) ?? combined.slice(0, 800)
        broadcast({ sessionId, planFile, subtaskId: 'test-fix', subtaskDescription: `Attempt ${retryCount + 1}/${MAX_RETRIES} — fixing…`, status: 'retrying', retryCount, maxRetries: MAX_RETRIES, doneCount: retryCount, totalCount: MAX_RETRIES })
        const response = await streamToString([
          { role: 'system', content: 'You are an expert software engineer. Fix the failing tests by editing source files only. Use <<<EDIT path>>> ... <<<END_EDIT>>> blocks.' },
          { role: 'user', content: `Test run failed:\n\`\`\`\n${summary}\n\`\`\`\nFix the failures by proposing file edits.` },
        ], opts.model, controller.signal)
        const edits = parseEdits(response)
        for (const edit of edits) {
          if (controller.signal.aborted) return
          try { await applyEdit(edit, projectPath) }
          catch { /* ignore single-file failure, continue with others */ }
        }
        retryCount++
      }
      broadcast({ sessionId, planFile, subtaskId: 'test-fix', subtaskDescription: 'Could not fix all failures within retry budget', status: 'blocked', error: `Exhausted ${MAX_RETRIES} retries`, doneCount: MAX_RETRIES, totalCount: MAX_RETRIES })
    } finally {
      if (testFixSession?.sessionId === sessionId) testFixSession = null
    }
  })()

  return sessionId
}

// ── Session replay (Gap 51) ───────────────────────────────────────────────────

function broadcastOnly(progress: AgentProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('agent:progress', progress)
  }
}

const DEFAULT_REPLAY_SPEEDUP = 10
const REPLAY_MAX_STEP_MS = 2000

/**
 * Re-emits a past session's persisted event log over the same 'agent:progress'
 * channel the live agent uses, at `speedup`× the original pacing (capped
 * per-step so a long real-world pause doesn't stall the replay; Gap 68 lets the
 * caller override the default 10x). Re-emitted events are NOT re-appended to
 * the log (uses broadcastOnly, not broadcast) — replaying a session must not
 * duplicate or grow its own history.
 * Refuses to run alongside a real active session to avoid interleaving the
 * two on the same channel.
 */
export async function replaySession(sessionId: string, speedup = DEFAULT_REPLAY_SPEEDUP): Promise<boolean> {
  if (activeSessions.size > 0) return false
  const events = readEvents(sessionId)
  if (events.length === 0) return false

  for (let i = 0; i < events.length; i++) {
    if (activeSessions.size > 0) break // a real session started mid-replay — bail out
    broadcastOnly(events[i] as unknown as AgentProgress)
    if (i < events.length - 1) {
      const curTs = events[i].ts as number
      const nextTs = events[i + 1].ts as number
      const delay = Math.min(Math.max(0, nextTs - curTs) / speedup, REPLAY_MAX_STEP_MS)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  return true
}

/**
 * Recovers the code diff a past session produced via the branch's merge-base
 * against the current HEAD, run against the main checkout (projectPath) rather
 * than the worktree — the worktree is normally removed once a PR is opened
 * (Gap 41's cleanup), but the branch ref itself survives, so the diff is still
 * recoverable for audit purposes. Returns '' if the branch no longer exists.
 */
export async function getSessionDiff(branch: string): Promise<string> {
  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()
  try {
    const mergeBase = (await runGit(projectPath, ['merge-base', 'HEAD', branch])).trim()
    return await runGit(projectPath, ['diff', mergeBase, branch])
  } catch {
    return ''
  }
}

/**
 * Renders a session's verification report (.lakoora/reports/<sessionId>.md) as a
 * standalone styled HTML file alongside it, for sharing with an auditor who
 * doesn't have a Markdown renderer. Returns the written file's path, or null
 * if no report exists for that session.
 */
export async function exportReportHtml(sessionId: string): Promise<string | null> {
  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()
  const reportDir = path.join(projectPath, '.lakoora', 'reports')
  const mdPath = path.join(reportDir, `${sessionId}.md`)
  try {
    const { promises: fsp } = await import('fs')
    const markdown = await fsp.readFile(mdPath, 'utf-8')
    const { markdownToHtml } = await import('../reportFormat')
    const html = markdownToHtml(markdown, `Agent Session Report — ${sessionId}`)
    const htmlPath = path.join(reportDir, `${sessionId}.html`)
    await fsp.writeFile(htmlPath, html)
    return htmlPath
  } catch {
    return null
  }
}

/** Gap 76 — export the session verification report as PDF using Electron's
 *  built-in printToPDF — no external PDF library needed. Generates the HTML
 *  first if it does not exist, then renders it in an offscreen window. */
export async function exportReportPdf(sessionId: string): Promise<string | null> {
  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()
  const reportDir = path.join(projectPath, '.lakoora', 'reports')
  const { promises: fsp } = await import('fs')

  // Ensure the HTML report exists (generate if not).
  let htmlPath = path.join(reportDir, `${sessionId}.html`)
  try {
    await fsp.access(htmlPath)
  } catch {
    htmlPath = (await exportReportHtml(sessionId)) ?? ''
    if (!htmlPath) return null
  }

  const pdfPath = path.join(reportDir, `${sessionId}.pdf`)
  const { BrowserWindow } = await import('electron')
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  try {
    await win.loadFile(htmlPath)
    const pdfBuffer = await win.webContents.printToPDF({ printBackground: true })
    await fsp.writeFile(pdfPath, pdfBuffer)
    return pdfPath
  } catch {
    return null
  } finally {
    win.destroy()
  }
}
