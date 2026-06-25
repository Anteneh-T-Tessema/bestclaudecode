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
import { loadPolicy, checkCommand, checkPath, checkApproval } from '../policyEngine'
import { detectDeployCommand, runDeploy } from '../deploy'
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
}

interface Subtask {
  id: string
  description: string
  depends_on: string[]
  done: boolean
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

function parseEdits(text: string): EditBlock[] {
  return [...text.matchAll(EDIT_RE)].map((m) => ({ path: m[1].trim(), content: m[2] }))
}

function parseRuns(text: string): RunBlock[] {
  return [...text.matchAll(RUN_RE)].map((m) => ({ command: m[1].trim() }))
}

function parseBrowses(text: string): BrowseBlock[] {
  return [...text.matchAll(BROWSE_RE)].map((m) => ({ url: m[1].trim(), task: m[2].trim() }))
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

let activeSession: { sessionId: string; abort: () => void } | null = null

// ── Governance approval gate (Gap 57) ─────────────────────────────────────────
// Only one agent session runs at a time, so a single module-level slot (rather
// than a map) is enough to track the one outstanding approval request.

interface ApprovalResult {
  approved: boolean
  /** OS username of whoever clicked Approve/Reject (Gap 61) — there's no separate login system in this single-user app. */
  approver: string
}

let pendingApproval: { sessionId: string; resolve: (result: ApprovalResult) => void } | null = null

function requestApproval(sessionId: string): Promise<ApprovalResult> {
  return new Promise<ApprovalResult>((resolve) => {
    pendingApproval = { sessionId, resolve }
  })
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

async function streamToString(
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

  try {
    const { deployUrl } = await runDeploy(worktreePath, deployCmd)
    broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'deployed', doneCount, totalCount, branch, prUrl, deployUrl })
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

Only one command per RUN block, one URL per BROWSE block. After your implementation, briefly summarise what you did.`

export async function startAutonomousSession(opts: {
  planFile: string
  model: string
}): Promise<string> {
  if (activeSession) throw new Error('Agent already running — stop it first')

  const sessionId = randomUUID()
  const controller = new AbortController()
  activeSession = { sessionId, abort: () => controller.abort() }

  const { planFile, model } = opts
  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()

  void (async () => {
    let worktreePath: string | null = null
    let activePath = projectPath
    let agentBranch = ''

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
          if (worktreePath) {
            await finalizeSession({ sessionId, planFile, plan, projectPath, worktreePath, branch: agentBranch, doneCount })
          } else {
            await writeVerificationReport({ sessionId, projectPath, plan, branch: agentBranch, doneCount, totalCount, prUrl: null })
            broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'finished', doneCount, totalCount })
          }
          break
        }

        const subtask = pending[0]
        const isRetry = retryContext !== null

        broadcast({
          sessionId, planFile,
          subtaskId: subtask.id,
          subtaskDescription: subtask.description,
          status: isRetry ? 'retrying' : 'running',
          doneCount, totalCount,
          branch: agentBranch || undefined,
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
        const promptBlocks = [contextBlock, memoryBlock, diffBlock].filter(Boolean)
        const systemPrompt = promptBlocks.length
          ? `${agentSystemPrompt}\n\n${promptBlocks.join('\n\n')}`
          : agentSystemPrompt

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
            // Gap 78 — OS-level desktop notification so the user knows approval is needed
            // even when the IDE is in the background.
            const { Notification } = await import('electron')
            if (Notification.isSupported()) {
              new Notification({
                title: 'Lakoora — Approval Required',
                body: `Agent paused: "${run.command}" requires your approval.`,
              }).show()
            }
            const { approved, approver } = await requestApproval(sessionId)
            if (!approved) {
              broadcast({
                sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description,
                status: 'approval-rejected', error: `Rejected by ${approver}: ${run.command}`, doneCount, totalCount,
              })
              return // human rejection halts the session cleanly — no retry, worktree left intact for review
            }
            broadcast({
              sessionId, planFile, subtaskId: subtask.id,
              subtaskDescription: `${subtask.description} (approved by ${approver})`,
              status: 'running', doneCount, totalCount,
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

        // Subtask succeeded
        await markDone(planFile, subtask.id)
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
      if (activeSession?.sessionId === sessionId) activeSession = null
    }
  })()

  return sessionId
}

export function stopAutonomousSession(): void {
  activeSession?.abort()
  activeSession = null
}

export function getActiveSession(): string | null {
  return activeSession?.sessionId ?? null
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
  if (activeSession) return false
  const events = readEvents(sessionId)
  if (events.length === 0) return false

  for (let i = 0; i < events.length; i++) {
    if (activeSession) break // a real session started mid-replay — bail out
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
