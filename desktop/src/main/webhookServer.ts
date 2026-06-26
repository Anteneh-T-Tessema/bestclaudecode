/**
 * Inbound webhook listener — the Integration Fabric's missing half. Until now
 * Meshflow only ever pulled from external systems (Linear, Jira, GitHub PR/issue
 * fetches); this lets external systems push into Meshflow:
 *
 *   POST /webhook/slack   — Slack slash command body (application/x-www-form-urlencoded)
 *                            → creates a plan from the command text and starts an agent session.
 *   POST /webhook/github  — GitHub `pull_request` webhook payload (JSON)
 *                            → on `action: "opened"`, runs an AI review and posts it via `gh`.
 *   GET  /health          — liveness/status probe for external monitoring.
 *
 * Auth is an optional shared secret (X-Meshflow-Secret header), configured via
 * Settings → Webhooks. With no secret configured the server accepts requests
 * unauthenticated — acceptable for local/loopback use, not for exposing the
 * port beyond localhost.
 *
 * Team Collaboration (shared agent sessions) adds three more routes, with a
 * separate `collabToken` auth (own trust boundary from `webhookSecret` —
 * teammates watching a session vs. inbound automation):
 *
 *   GET  /watch?session=&token=         — static HTML+JS viewer page
 *   GET  /watch-stream?session=&token=  — Server-Sent Events feed of live agent:progress
 *   POST /session/:id/approve           — remote Approve/Reject, calls resolveApproval() directly
 */

import * as http from 'http'
import { store, getSecret } from './store'
import { repoRoot } from './paths'
import { runPythonJson } from './pythonBridge'
import { getPrDiff, postPrReview } from './gitOps'
import { startAutonomousSession, getActiveSessions, streamToString, resolveApproval } from './agents/autonomousAgent'
import { readEvents } from './agentEventLog'
import { subscribe } from './sessionRelay'
import { renderWatchPage } from './collabViewer'

const DEFAULT_PORT = 7391

let server: http.Server | null = null

export function getWebhookPort(): number {
  const raw = store.get('webhookPort') as string | number | undefined
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}

export function isWebhookServerRunning(): boolean {
  return server !== null
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const expected = getSecret('webhookSecret')
  if (!expected) return true
  return req.headers['x-meshflow-secret'] === expected
}

/** Separate trust boundary from isAuthorized() — collabToken is for human teammates watching a session, not inbound automation. */
function isCollabAuthorized(token: string | null): boolean {
  const expected = getSecret('collabToken')
  if (!expected) return false // unlike webhooks, collab links must always be tokened
  return token === expected
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/** `text` from a Slack slash command becomes the goal for a brand-new plan + agent session. */
async function handleSlackCommand(body: string): Promise<{ status: number; payload: unknown }> {
  const params = new URLSearchParams(body)
  const text = params.get('text')?.trim() ?? ''
  if (!text) return { status: 200, payload: { text: 'Usage: /meshflow <goal for the agent>' } }

  const result = await runPythonJson(['-m', 'src.task_planner', '--new', text, '--save'])
  if (!result.ok) return { status: 200, payload: { text: `Failed to create plan: ${result.error}` } }

  const planFile = `plans/${(result.stats as { slug: string }).slug}.json`
  const model = (store.get('activeModel') as string | undefined) ?? 'claude-sonnet-4-6'
  try {
    const sessionId = await startAutonomousSession({ planFile, model })
    return { status: 200, payload: { text: `Started Meshflow agent session \`${sessionId.slice(0, 8)}\` for: ${text}` } }
  } catch (err) {
    return { status: 200, payload: { text: `Could not start agent: ${err}` } }
  }
}

/** On `pull_request` `opened`, generates an AI review draft and posts it as a GitHub PR review. */
async function handleGithubPullRequest(body: string): Promise<{ status: number; payload: unknown }> {
  let event: { action?: string; number?: number }
  try {
    event = JSON.parse(body)
  } catch {
    return { status: 400, payload: { error: 'invalid JSON body' } }
  }
  if (event.action !== 'opened' || !event.number) return { status: 200, payload: { skipped: true } }

  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()
  const diff = await getPrDiff(projectPath, event.number)
  if (!diff.trim()) return { status: 200, payload: { skipped: true, reason: 'empty diff' } }

  const model = (store.get('activeModel') as string | undefined) ?? 'claude-sonnet-4-6'
  const controller = new AbortController()
  let response: string
  try {
    response = await streamToString(
      [
        {
          role: 'system',
          content: 'You are an automated PR reviewer. Respond ONLY with JSON: {"summary": string, "comments": [{"path": string, "line": number, "body": string}]}. Be concise; only comment on real issues.',
        },
        { role: 'user', content: `Review this PR diff:\n\n${diff.slice(0, 12000)}` },
      ],
      model,
      controller.signal,
    )
  } catch (err) {
    return { status: 200, payload: { error: String(err) } }
  }

  let parsed: { summary?: string; comments?: Array<{ path: string; line: number; body: string }> } = {}
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try { parsed = JSON.parse(jsonMatch[0]) } catch { parsed = { summary: response.slice(0, 1000) } }
  } else {
    parsed = { summary: response.slice(0, 1000) }
  }

  const posted = await postPrReview(projectPath, event.number, {
    body: parsed.summary ?? 'Automated review by Meshflow.',
    event: 'COMMENT',
    comments: parsed.comments ?? [],
  })
  return { status: 200, payload: { reviewed: posted, prNumber: event.number } }
}

async function handleSentryWebhook(body: string): Promise<{ status: number; payload: unknown }> {
  // Sentry sends JSON with an `event` object containing `level`, `message`, `logger`, `exception`
  let event: { event?: { level?: string; message?: string; exception?: { values?: Array<{ type?: string; value?: string }> } }; action?: string }
  try { event = JSON.parse(body) } catch { return { status: 400, payload: { error: 'invalid JSON' } } }
  if (event.action && event.action !== 'triggered') return { status: 200, payload: { skipped: true } }

  const level = event.event?.level ?? 'error'
  const message = event.event?.message ??
    event.event?.exception?.values?.[0]?.value ??
    'Unknown Sentry error'
  const type = event.event?.exception?.values?.[0]?.type ?? 'Error'

  // Only handle errors and fatals
  if (!['error', 'fatal', 'critical'].includes(level)) return { status: 200, payload: { skipped: true } }

  const { appendAlert } = await import('./monitorAlertLog')
  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()
  appendAlert(projectPath, `[Sentry ${type}] ${message}`, 'sentry')
  return { status: 200, payload: { received: true } }
}

async function handleDatadogWebhook(body: string): Promise<{ status: number; payload: unknown }> {
  let event: { alert_status?: string; alert_title?: string; body?: string; title?: string }
  try { event = JSON.parse(body) } catch { return { status: 400, payload: { error: 'invalid JSON' } } }

  // Only handle triggered alerts
  if (event.alert_status !== 'triggered') return { status: 200, payload: { skipped: true } }

  const title = event.alert_title ?? event.title ?? 'Datadog Alert'
  const detail = event.body ?? ''
  const message = detail ? `${title}: ${detail.slice(0, 200)}` : title

  const { appendAlert } = await import('./monitorAlertLog')
  const projectPath = (store.get('projectPath') as string | undefined) ?? repoRoot()
  appendAlert(projectPath, `[Datadog] ${message}`, 'datadog')
  return { status: 200, payload: { received: true } }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', activeSessions: getActiveSessions().length, timestamp: new Date().toISOString() })
      return
    }

    // Team Collaboration routes — own token-based auth, checked before (and
    // instead of) the webhook header auth below since browsers can't set
    // custom headers from a plain link click.
    if (req.method === 'GET' && url.pathname === '/watch') {
      const sessionId = url.searchParams.get('session') ?? ''
      const token = url.searchParams.get('token')
      if (!sessionId || !isCollabAuthorized(token)) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(renderWatchPage(sessionId, token ?? ''))
      return
    }

    if (req.method === 'GET' && url.pathname === '/watch-stream') {
      const sessionId = url.searchParams.get('session') ?? ''
      const token = url.searchParams.get('token')
      if (!sessionId || !isCollabAuthorized(token)) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      for (const event of readEvents(sessionId)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      const unsubscribe = subscribe(sessionId, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      })
      req.on('close', unsubscribe)
      return
    }

    const approveMatch = req.method === 'POST' && url.pathname.match(/^\/session\/([^/]+)\/approve$/)
    if (approveMatch) {
      const sessionId = approveMatch[1]
      const body = await readBody(req)
      let parsedBody: { approved?: boolean; token?: string; approver?: string }
      try {
        parsedBody = JSON.parse(body)
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' })
        return
      }
      if (!isCollabAuthorized(parsedBody.token ?? null)) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
      const resolved = resolveApproval(sessionId, parsedBody.approved === true, parsedBody.approver || 'remote-viewer')
      sendJson(res, 200, { success: resolved })
      return
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'POST' && req.url === '/webhook/slack') {
      const { status, payload } = await handleSlackCommand(await readBody(req))
      sendJson(res, status, payload)
      return
    }

    if (req.method === 'POST' && req.url === '/webhook/github') {
      if (req.headers['x-github-event'] !== 'pull_request') {
        sendJson(res, 200, { skipped: true })
        return
      }
      const { status, payload } = await handleGithubPullRequest(await readBody(req))
      sendJson(res, status, payload)
      return
    }

    if (req.method === 'POST' && url.pathname === '/webhook/sentry') {
      const { status, payload } = await handleSentryWebhook(await readBody(req))
      sendJson(res, status, payload)
      return
    }

    if (req.method === 'POST' && url.pathname === '/webhook/datadog') {
      const { status, payload } = await handleDatadogWebhook(await readBody(req))
      sendJson(res, status, payload)
      return
    }

    sendJson(res, 404, { error: 'not found' })
  } catch (err) {
    sendJson(res, 500, { error: String(err) })
  }
}

export function startWebhookServer(): Promise<{ success: boolean; port?: number; error?: string }> {
  if (server) return Promise.resolve({ success: true, port: getWebhookPort() })

  const port = getWebhookPort()
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => { void handleRequest(req, res) })
    srv.once('error', (err) => {
      server = null
      resolve({ success: false, error: String(err) })
    })
    srv.listen(port, () => {
      server = srv
      resolve({ success: true, port })
    })
  })
}

export function stopWebhookServer(): boolean {
  if (!server) return false
  server.close()
  server = null
  return true
}
