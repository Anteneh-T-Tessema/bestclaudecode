import type { HandlerRegistry } from '../router.js'
import { MUTABLE_KEYS, SECRET_KEYS, getSetting, setSetting, getAllPublicSettings, clearSessionSettings } from '../settings/store.js'

// Faithful subset-port of desktop/src/main/ipc/settings.handlers.ts. Not
// ported: settings:checkEngine, settings:exportSettings/importSettings —
// these are Electron-native-dialog/local-filesystem concerns with no
// meaningful cloud equivalent yet, not silently stubbed.
export function registerSettingsHandlers(registry: HandlerRegistry): void {
  registry.register('settings:get', async (_adapter, payload, ctx) => {
    const key = payload as string
    return getSetting(ctx.sessionId, key)
  })

  registry.register('settings:set', async (_adapter, payload, ctx) => {
    const { key, value } = payload as { key: string; value: unknown }
    if (!MUTABLE_KEYS.has(key) && !SECRET_KEYS.has(key)) {
      throw new Error(`settings:set — key "${key}" is not mutable via this channel`)
    }
    setSetting(ctx.sessionId, key, value)
    return { success: true }
  })

  registry.register('settings:getAll', async (_adapter, _payload, ctx) => {
    return getAllPublicSettings(ctx.sessionId)
  })

  registry.register('settings:validateKey', async (_adapter, payload) => {
    const { provider, key } = payload as { provider: 'anthropic' | 'openai' | 'mistral' | 'fireworks'; key: string }
    try {
      // SDKs default to a multi-minute timeout — far too long for an interactive
      // "validate key" click. 8s covers a models.list() or lightweight probe.
      if (provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const client = new Anthropic({ apiKey: key, timeout: 8_000 })
        await client.models.list()
        return { valid: true }
      } else if (provider === 'openai') {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey: key, timeout: 8_000 })
        await client.models.list()
        return { valid: true }
      } else if (provider === 'mistral') {
        // Probe the Mistral models endpoint — a 200 means the key is valid.
        const res = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8_000),
        })
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` }
      } else if (provider === 'fireworks') {
        // Fireworks uses an OpenAI-compatible models endpoint.
        const res = await fetch('https://api.fireworks.ai/inference/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8_000),
        })
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` }
      }
      return { valid: false, error: 'Unknown provider' }
    } catch (err) {
      return { valid: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 80) }
    }
  })

  registry.registerCleanup((sessionId) => {
    clearSessionSettings(sessionId)
  })
}
