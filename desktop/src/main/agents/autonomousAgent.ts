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
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { runPythonJson, runCommand } from '../pythonBridge'
import { repoRoot } from '../paths'
import { store } from '../store'
import * as path from 'path'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentProgress {
  sessionId: string
  planFile: string
  subtaskId: string
  subtaskDescription: string
  status: 'running' | 'done' | 'retrying' | 'blocked' | 'finished' | 'error'
  output?: string
  error?: string
  doneCount: number
  totalCount: number
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
    try {
      let retryContext: string | null = null

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
          broadcast({ sessionId, planFile, subtaskId: '', subtaskDescription: '', status: 'finished', doneCount, totalCount })
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
        })

        const userContent = isRetry
          ? `Previous attempt failed:\n${retryContext}\n\nRetry the same subtask:\n${subtask.description}`
          : subtask.description

        let response: string
        try {
          response = await streamToString(
            [
              { role: 'system', content: AGENT_SYSTEM_PROMPT },
              { role: 'user', content: userContent },
            ],
            model,
            controller.signal,
          )
        } catch (err) {
          broadcast({ sessionId, planFile, subtaskId: subtask.id, subtaskDescription: subtask.description, status: 'error', error: String(err), doneCount, totalCount })
          break
        }

        if (controller.signal.aborted) break

        // Apply edits
        const edits = parseEdits(response)
        let editError: string | null = null
        for (const edit of edits) {
          try { await applyEdit(edit, projectPath) }
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

        // Run commands
        const runs = parseRuns(response)
        let runError: string | null = null
        for (const run of runs) {
          if (isBlocked(run.command)) {
            runError = `Command blocked by safety policy: ${run.command}`
            break
          }
          try {
            const result = await runCommand('/bin/sh', ['-c', run.command], projectPath)
            if (result.exitCode !== 0) {
              runError = `Command failed (exit ${result.exitCode}): ${run.command}\n${result.stderr}`
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

