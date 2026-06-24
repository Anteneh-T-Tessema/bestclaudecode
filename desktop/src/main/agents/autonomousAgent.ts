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
import { store } from '../store'
import { runChatContext } from '../chatContext'
import { queryAgentMemory } from '../agentMemory'
import { resolveModel } from '../modelRouter'
import { createWorktree, commitAll, push, createPr, removeWorktree, runGit } from '../gitOps'
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
    | 'deploying' | 'deployed'
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

// ── Progress broadcast ────────────────────────────────────────────────────────

function broadcast(progress: AgentProgress): void {
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

// ── Deploy URL extractor ──────────────────────────────────────────────────────

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/)
  return m ? m[0] : null
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
    const apiKey = store.get('anthropicApiKey') as string | undefined
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
    const apiKey = store.get('openaiApiKey') as string | undefined
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
  const { promises: fs } = await import('fs')

  let deployCmd: string | null = null

  try {
    const raw = await fs.readFile(path.join(worktreePath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    if (pkg.scripts?.deploy) deployCmd = 'npm run deploy'
  } catch { /* no package.json or no deploy script */ }

  if (!deployCmd) {
    for (const candidate of ['vercel.json', '.vercel']) {
      try {
        await fs.access(path.join(worktreePath, candidate))
        deployCmd = 'vercel'
        break
      } catch { /* not found */ }
    }
  }

  if (!deployCmd) return

  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: `Running ${deployCmd}…`, status: 'deploying', doneCount, totalCount, branch, prUrl })

  try {
    const result = await runCommand('/bin/sh', ['-c', deployCmd], worktreePath)
    const combined = result.stdout + '\n' + result.stderr
    const deployUrl = extractUrl(combined) ?? undefined
    broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'deployed', doneCount, totalCount, branch, prUrl, deployUrl })
  } catch { /* deploy failed — not fatal, session already succeeded */ }
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
    broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'finished', doneCount, totalCount })
    return
  }

  // Push
  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: `Pushing branch ${branch}…`, status: 'finalizing', doneCount, totalCount, branch })
  try {
    await push(worktreePath, branch)
  } catch (err) {
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
    broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: `Branch ${branch} pushed but PR creation failed (no gh or not authenticated)`, status: 'push-failed-kept-locally', doneCount, totalCount, branch })
    return
  }

  broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'pr-opened', doneCount, totalCount, branch, prUrl })

  // Attempt deployment (before cleanup — deploy runs against the worktree state)
  await attemptDeploy({ sessionId, planFile, doneCount, totalCount, branch, prUrl, worktreePath })

  // Cleanup only on full success (pushed + PR opened)
  await removeWorktree(projectPath, worktreePath, true).catch(() => {})

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

      let retryContext: string | null = null
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
          ? `${AGENT_SYSTEM_PROMPT}\n\n${promptBlocks.join('\n\n')}`
          : AGENT_SYSTEM_PROMPT

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
          try { await applyEdit(edit, activePath) }
          catch (err) { editError = `Edit failed for ${edit.path}: ${err}`; break }
        }

        if (editError) {
          if (isRetry) {
            broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'blocked', error: editError, doneCount, totalCount })
            break
          }
          retryContext = editError
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
          } catch (err) {
            runError = `Command error: ${err}`
            break
          }
        }

        if (runError) {
          if (isRetry) {
            broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'blocked', error: runError, doneCount, totalCount })
            break
          }
          retryContext = runError
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
        }

        if (browseError) {
          if (isRetry) {
            broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'blocked', error: browseError, doneCount, totalCount })
            break
          }
          retryContext = browseError
          continue
        }

        // Subtask succeeded
        await markDone(planFile, subtask.id)
        retryContext = null
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
