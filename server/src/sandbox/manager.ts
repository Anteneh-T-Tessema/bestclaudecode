import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { LocalSandboxAdapter } from './localAdapter.js'
import { E2bSandboxAdapter } from './e2bAdapter.js'
import type { SandboxAdapter } from './types.js'

export type SandboxBackend = 'local' | 'e2b'

export interface SandboxManagerOptions {
  backend?: SandboxBackend
  e2bApiKey?: string
  e2bTemplateId?: string
  localRoot?: string
}

interface SessionEntry {
  adapter: SandboxAdapter
  isTempRoot: boolean
  localRoot?: string
}

// One SandboxManager per running server process. Tracks one adapter per
// session ID and is the only place that decides local-vs-E2B — handlers
// never construct an adapter directly, they ask the manager for one.
export class SandboxManager {
  private readonly sessions = new Map<string, SessionEntry>()
  private readonly backend: SandboxBackend
  private readonly e2bApiKey?: string
  private readonly e2bTemplateId?: string
  private readonly localRoot?: string

  constructor(opts: SandboxManagerOptions = {}) {
    this.backend = opts.backend ?? (process.env.E2B_API_KEY ? 'e2b' : 'local')
    this.e2bApiKey = opts.e2bApiKey ?? process.env.E2B_API_KEY
    this.e2bTemplateId = opts.e2bTemplateId ?? process.env.E2B_TEMPLATE_ID
    this.localRoot = opts.localRoot
  }

  async getOrCreate(sessionId: string): Promise<SandboxAdapter> {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing.adapter

    if (this.backend === 'e2b') {
      const adapter = await E2bSandboxAdapter.create({
        apiKey: this.e2bApiKey,
        templateId: this.e2bTemplateId,
      })
      this.sessions.set(sessionId, { adapter, isTempRoot: false })
      return adapter
    }

    if (this.localRoot) {
      const adapter = new LocalSandboxAdapter(this.localRoot)
      this.sessions.set(sessionId, { adapter, isTempRoot: false })
      return adapter
    }

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lakoora-session-'))
    const adapter = new LocalSandboxAdapter(tempRoot)
    this.sessions.set(sessionId, { adapter, isTempRoot: true, localRoot: tempRoot })
    return adapter
  }

  get(sessionId: string): SandboxAdapter | undefined {
    return this.sessions.get(sessionId)?.adapter
  }

  async destroy(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    await entry.adapter.destroy()
    if (entry.isTempRoot && entry.localRoot) {
      await rm(entry.localRoot, { recursive: true, force: true })
    }
    this.sessions.delete(sessionId)
  }

  async destroyAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.destroy(id)))
  }
}
