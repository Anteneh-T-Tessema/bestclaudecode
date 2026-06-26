import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as http from 'http'

let tmpUserData = ''
let projectPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('./paths', () => ({
  repoRoot: () => projectPath,
}))

import { setSecret } from './store'
import { startWebhookServer, stopWebhookServer } from './webhookServer'
import { appendEvent } from './agentEventLog'
import { publish } from './sessionRelay'

function get(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port, path: urlPath }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    }).on('error', reject)
  })
}

function getSSE(port: number, urlPath: string, onChunk: (chunk: string) => void): { close: () => void } {
  const req = http.get({ host: 'localhost', port, path: urlPath }, (res) => {
    res.on('data', (c: Buffer) => onChunk(c.toString()))
  })
  return { close: () => req.destroy() }
}

function post(port: number, urlPath: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(
      { host: 'localhost', port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let resBody = ''
        res.on('data', (c) => { resBody += c })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: resBody }))
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

describe('webhookServer collab routes', () => {
  let port = 0

  beforeAll(async () => {
    tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-webhook-userdata-'))
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-webhook-project-'))
    setSecret('collabToken', 'test-token-123')
    const result = await startWebhookServer()
    expect(result.success).toBe(true)
    port = result.port!
  })

  afterAll(() => {
    stopWebhookServer()
    fs.rmSync(tmpUserData, { recursive: true, force: true })
    fs.rmSync(projectPath, { recursive: true, force: true })
  })

  it('GET /health returns ok with no auth required', async () => {
    const res = await get(port, '/health')
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body)
    expect(json.status).toBe('ok')
  })

  it('GET /watch without a token is rejected', async () => {
    const res = await get(port, '/watch?session=abc')
    expect(res.status).toBe(401)
  })

  it('GET /watch with the right token returns the HTML viewer page', async () => {
    const res = await get(port, '/watch?session=abc&token=test-token-123')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<html')
    expect(res.body).toContain('abc')
  })

  it('GET /watch-stream delivers backlog then a live published event over SSE', async () => {
    const sessionId = 'session-backlog-test'
    appendEvent(sessionId, { status: 'running', subtaskDescription: 'backlog event' })

    const chunks: string[] = []
    const stream = getSSE(port, `/watch-stream?session=${sessionId}&token=test-token-123`, (c) => chunks.push(c))

    await new Promise((r) => setTimeout(r, 200))
    expect(chunks.join('')).toContain('backlog event')

    publish(sessionId, { status: 'done', subtaskDescription: 'live event' })
    await new Promise((r) => setTimeout(r, 200))
    expect(chunks.join('')).toContain('live event')

    stream.close()
  })

  it('GET /watch-stream without the right token is rejected', async () => {
    const res = await get(port, '/watch-stream?session=abc&token=wrong')
    expect(res.status).toBe(401)
  })

  it('POST /session/:id/approve without the right token is rejected', async () => {
    const res = await post(port, '/session/some-id/approve', { approved: true, token: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('POST /session/:id/approve with the right token but no pending approval returns success:false', async () => {
    const res = await post(port, '/session/no-such-session/approve', { approved: true, token: 'test-token-123', approver: 'tester' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ success: false })
  })
})
