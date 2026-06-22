import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { runPythonJson, REPO_ROOT, VENV_PYTHON } from '../pythonBridge.js'
import { getSetting } from '../settings/store.js'
import type { HandlerRegistry } from '../router.js'
import type { SandboxAdapter } from '../sandbox/types.js'

// ── Types ──────────────────────────────────────────────────────────────────

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

interface EditBlock { path: string; content: string }
interface RunBlock  { command: string }
interface BrowseBlock { url: string; task: string }

// ── Block parsers ──────────────────────────────────────────────────────────

const EDIT_RE   = /<<<EDIT ([^\n>]+)>>>\n([\s\S]*?)\n<<<END_EDIT>>>/g
const RUN_RE    = /<<<RUN>>>\n([\s\S]*?)\n<<<END_RUN>>>/g
const BROWSE_RE = /<<<BROWSE url="([^"]+)" task="([^"]+)">>>/g

function parseEdits(text: string):  EditBlock[]   { return [...text.matchAll(EDIT_RE)].map((m)  => ({ path: m[1].trim(), content: m[2] })) }
function parseRuns(text: string):   RunBlock[]    { return [...text.matchAll(RUN_RE)].map((m)   => ({ command: m[1].trim() })) }
function parseBrowse(text: string): BrowseBlock[] { return [...text.matchAll(BROWSE_RE)].map((m) => ({ url: m[1], task: m[2] })) }

// ── Safety blocklist ───────────────────────────────────────────────────────

const BLOCKED = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(\/|~|\$HOME|\$\{HOME\})/i,
  /:\(\)\s*\{\s*:|:\s*&\s*\}/,
  /dd\s+if=\/dev\/zero\s+of=\/dev\//i,
  /\bmkfs\b/i,
]
function isBlocked(cmd: string): boolean { return BLOCKED.some((re) => re.test(cmd)) }

// ── Session registry ───────────────────────────────────────────────────────

interface AgentSession {
  abort: () => void
  sessionId: string
  send: (channel: string, payload: unknown) => void
}

const agentSessions = new Map<string, AgentSession>()

// ── AI streaming ───────────────────────────────────────────────────────────

async function streamToString(
  messages: Array<{ role: string; content: string }>,
  model: string,
  signal: AbortSignal,
  sessionId: string,
): Promise<string> {
  let result = ''

  if (model.startsWith('claude')) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const apiKey = getSetting(sessionId, 'anthropicApiKey') as string | undefined
    if (!apiKey) throw new Error('Anthropic API key not configured')
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream({
      model,
      max_tokens: 8192,
      messages: messages.filter((m) => m.role !== 'system').map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })
    for await (const chunk of stream) {
      if (signal.aborted) break
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        result += chunk.delta.text
      }
    }
    return result
  }

  if (model.startsWith('gpt')) {
    const { default: OpenAI } = await import('openai')
    const apiKey = getSetting(sessionId, 'openaiApiKey') as string | undefined
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

  // Ollama fallback
  const ollamaUrl = (getSetting(sessionId, 'ollamaUrl') as string | undefined) ?? 'http://localhost:11434'
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
        try { result += (JSON.parse(line) as { message?: { content?: string } }).message?.content ?? '' }
        catch { /* partial line */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return result
}

// ── Python bridge helpers ──────────────────────────────────────────────────

async function loadPlan(planFile: string): Promise<TaskPlanDetail | null> {
  const res = await runPythonJson(['-m', 'src.task_planner', '--show', planFile, '--json'])
  const detail = res as unknown as (TaskPlanDetail & { ok?: boolean; stats?: TaskPlanDetail })
  if ('stats' in detail && detail.stats) return detail.stats
  if ('goal' in detail) return detail as unknown as TaskPlanDetail
  return null
}

async function markDone(planFile: string, subtaskId: string): Promise<void> {
  await runPythonJson(['-m', 'src.task_planner', '--done', planFile, subtaskId, '--json'])
}

async function revisePlan(planFile: string, revisedSubtasks: Subtask[]): Promise<void> {
  await runPythonJson([
    '-m', 'src.task_planner', '--revise', planFile, JSON.stringify(revisedSubtasks), '--json',
  ])
}

async function queryMemory(query: string): Promise<string> {
  try {
    const res = await runPythonJson(['-m', 'src.agent_memory', '--query', query, '--json'])
    const entries = (Array.isArray(res) ? res : (res as { result?: unknown[] }).result ?? []) as Array<{
      key: string; content: string; tags: string[]
    }>
    if (!entries.length) return ''
    const lines = ['## Agent memory (past learnings)\n']
    for (const e of entries) {
      const tagStr = e.tags?.length ? ` [${e.tags.join(', ')}]` : ''
      lines.push(`**${e.key}**${tagStr}`, e.content.trim(), '')
    }
    return lines.join('\n')
  } catch { return '' }
}

async function recordMemory(task: string, outcome: string): Promise<void> {
  await runPythonJson(['-m', 'src.agent_memory', '--write', `task:${task.slice(0, 40)}`, outcome, '--json']).catch(() => {})
}

async function runBrowse(url: string, task: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(VENV_PYTHON, ['-m', 'src.browser_context', '--url', url, '--task', task, '--json'], { cwd: REPO_ROOT })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', () => {
      try {
        const r = JSON.parse(stdout) as { result: string; success: boolean }
        resolve(r.success ? r.result : `Browse failed: ${r.result}`)
      } catch {
        resolve('Browse failed: could not parse result')
      }
    })
    proc.on('error', (err) => resolve(`Browse error: ${err.message}`))
  })
}

// ── Replanning ─────────────────────────────────────────────────────────────

const REPLAN_SYSTEM = `You are a task planning agent. Given a failed subtask and remaining plan, \
return a revised JSON array of subtasks. Each item: {"id":"...", "description":"...", "depends_on":[], "done":false}. \
Respond with ONLY valid JSON — no prose, no markdown fences.`

async function replanSubtasks(
  plan: TaskPlanDetail,
  failedSubtask: Subtask,
  error: string,
  model: string,
  signal: AbortSignal,
  sessionId: string,
): Promise<Subtask[]> {
  const pending = plan.subtasks.filter((s) => !s.done)
  const doneIds = plan.subtasks.filter((s) => s.done).map((s) => s.id).join(', ') || 'none'
  const prompt = [
    `Goal: ${plan.goal}`,
    '',
    `Failed subtask: [${failedSubtask.id}] ${failedSubtask.description}`,
    `Error: ${error}`,
    '',
    `Remaining subtasks to revise:`,
    ...pending.map((s) => `  [${s.id}] ${s.description}`),
    '',
    `Completed subtasks (preserve, do not include): ${doneIds}`,
    `Return ONLY a JSON array of revised subtasks to replace the remaining work.`,
  ].join('\n')

  const response = await streamToString(
    [{ role: 'system', content: REPLAN_SYSTEM }, { role: 'user', content: prompt }],
    model, signal, sessionId,
  )
  const json = response.replace(/```(?:json)?/g, '').trim()
  return JSON.parse(json) as Subtask[]
}

// ── Agent system prompt ────────────────────────────────────────────────────

const AGENT_SYSTEM = `You are an autonomous coding agent running inside the Lakoora IDE.
You receive one subtask at a time from a task plan. Implement it completely.

To write files:
<<<EDIT relative/path/to/file.ext>>>
...full file content...
<<<END_EDIT>>>

To run a shell command:
<<<RUN>>>
command here
<<<END_RUN>>>

To browse the web:
<<<BROWSE url="https://..." task="what to do on the page">>>

Only one command per RUN block. After your implementation, briefly summarise what you did.`

// ── Orchestration loop ─────────────────────────────────────────────────────

const SANDBOX_PROJECT_ROOT = '/home/user/project'

async function runAgentLoop(opts: {
  sessionId: string
  planFile: string
  model: string
  sandbox: SandboxAdapter
  send: (channel: string, payload: unknown) => void
  signal: AbortSignal
}): Promise<void> {
  const { sessionId, planFile, model, sandbox, send, signal } = opts

  function emit(subtaskId: string, subtaskDescription: string, status: string, extra: Record<string, unknown> = {}): void {
    send('agent:progress', { sessionId, planFile, subtaskId, subtaskDescription, status, ...extra })
  }

  let replanContext: { subtask: Subtask; error: string } | null = null
  let retryContext: string | null = null

  while (true) {
    if (signal.aborted) break

    const plan = await loadPlan(planFile)
    if (!plan) { emit('', '', 'error', { error: 'Failed to load plan' }); break }

    const pending = plan.subtasks.filter((s) => !s.done)
    const doneCount = plan.subtasks.length - pending.length
    const totalCount = plan.subtasks.length

    if (pending.length === 0) { emit('', '', 'finished', { doneCount, totalCount }); break }

    const subtask = pending[0]
    const isRetry = retryContext !== null

    // — On second failure: replan instead of blocking —
    if (replanContext) {
      emit(subtask.id, subtask.description, 'replanning', { error: replanContext.error, doneCount, totalCount })
      try {
        const revised = await replanSubtasks(plan, replanContext.subtask, replanContext.error, model, signal, sessionId)
        await revisePlan(planFile, revised)
        replanContext = null
        retryContext = null
        continue
      } catch (err) {
        emit(subtask.id, subtask.description, 'blocked', { error: `Replanning failed: ${err}`, doneCount, totalCount })
        break
      }
    }

    emit(subtask.id, subtask.description, isRetry ? 'retrying' : 'running', { doneCount, totalCount })

    // — Inject memory context —
    const memoryBlock = await queryMemory(subtask.description)

    const userContent = isRetry
      ? `Previous attempt failed:\n${retryContext}\n\nRetry the same subtask:\n${subtask.description}`
      : (memoryBlock ? `${memoryBlock}\n\n` : '') + subtask.description

    let response: string
    try {
      response = await streamToString(
        [{ role: 'system', content: AGENT_SYSTEM }, { role: 'user', content: userContent }],
        model, signal, sessionId,
      )
    } catch (err) {
      emit(subtask.id, subtask.description, 'error', { error: String(err), doneCount, totalCount })
      break
    }

    if (signal.aborted) break

    // — Apply EDIT blocks via sandbox —
    const edits = parseEdits(response)
    let editError: string | null = null
    for (const edit of edits) {
      const absPath = edit.path.startsWith('/') ? edit.path : path.posix.join(SANDBOX_PROJECT_ROOT, edit.path)
      try { await sandbox.writeFile(absPath, edit.content) }
      catch (err) { editError = `Edit failed for ${edit.path}: ${err}`; break }
    }

    if (editError) {
      if (isRetry) { replanContext = { subtask, error: editError }; retryContext = null; continue }
      retryContext = editError; continue
    }

    // — Run BROWSE blocks —
    const browses = parseBrowse(response)
    let browseError: string | null = null
    for (const b of browses) {
      const result = await runBrowse(b.url, b.task)
      if (result.startsWith('Browse failed') || result.startsWith('Browse error')) {
        browseError = result; break
      }
    }
    if (browseError) {
      if (isRetry) { replanContext = { subtask, error: browseError }; retryContext = null; continue }
      retryContext = browseError; continue
    }

    // — Run RUN blocks via sandbox —
    const runs = parseRuns(response)
    let runError: string | null = null
    for (const run of runs) {
      if (isBlocked(run.command)) { runError = `Blocked by safety policy: ${run.command}`; break }
      try {
        const result = await sandbox.runCommand(run.command, SANDBOX_PROJECT_ROOT, 120_000)
        if (result.exitCode !== 0) {
          runError = `Command failed (exit ${result.exitCode}): ${run.command}\n${result.stderr}`; break
        }
      } catch (err) { runError = `Command error: ${err}`; break }
    }

    if (runError) {
      if (isRetry) { replanContext = { subtask, error: runError }; retryContext = null; continue }
      retryContext = runError; continue
    }

    // — Success —
    await markDone(planFile, subtask.id)
    await recordMemory(subtask.description, `Completed: ${response.slice(0, 200)}`)
    retryContext = null
    emit(subtask.id, subtask.description, 'done', { output: response.slice(0, 500), doneCount: doneCount + 1, totalCount })
  }
}

// ── Handler registration ───────────────────────────────────────────────────

export function registerAgentHandlers(registry: HandlerRegistry): void {
  registry.register('agent:startAutonomous', async (adapter, payload, ctx) => {
    const { planFile, model } = payload as { planFile: string; model: string }

    const existing = agentSessions.get(ctx.sessionId)
    if (existing) throw new Error('Agent already running — stop it first')

    const controller = new AbortController()
    const session: AgentSession = { abort: () => controller.abort(), sessionId: ctx.sessionId, send: ctx.send.bind(ctx) }
    agentSessions.set(ctx.sessionId, session)

    void runAgentLoop({
      sessionId: ctx.sessionId, planFile, model,
      sandbox: adapter, send: ctx.send.bind(ctx),
      signal: controller.signal,
    }).finally(() => { agentSessions.delete(ctx.sessionId) })

    return { sessionId: ctx.sessionId }
  })

  registry.register('agent:stopAutonomous', async (_adapter, _payload, ctx) => {
    agentSessions.get(ctx.sessionId)?.abort()
    agentSessions.delete(ctx.sessionId)
    return { stopped: true }
  })

  registry.register('agent:getActiveSession', async (_adapter, _payload, ctx) => {
    return { sessionId: agentSessions.has(ctx.sessionId) ? ctx.sessionId : null }
  })

  // Shadow workspace stubs — implemented in Phase 4 (shadow_workspace.py);
  // the server wires them here so the API surface is complete.
  registry.register('agent:createShadow',      async (_a, payload) => runPythonJson(['-m', 'src.shadow_workspace', '--create',  JSON.stringify(payload), '--json']))
  registry.register('agent:getShadowDiff',      async (_a, payload) => runPythonJson(['-m', 'src.shadow_workspace', '--diff',    JSON.stringify(payload), '--json']))
  registry.register('agent:getShadowDiffVsBase',async (_a, payload) => runPythonJson(['-m', 'src.shadow_workspace', '--diffbase',JSON.stringify(payload), '--json']))
  registry.register('agent:promoteShadow',      async (_a, payload) => runPythonJson(['-m', 'src.shadow_workspace', '--promote', JSON.stringify(payload), '--json']))
  registry.register('agent:discardShadow',      async (_a, payload) => runPythonJson(['-m', 'src.shadow_workspace', '--discard', JSON.stringify(payload), '--json']))

  registry.registerCleanup((sessionId) => {
    agentSessions.get(sessionId)?.abort()
    agentSessions.delete(sessionId)
  })
}
