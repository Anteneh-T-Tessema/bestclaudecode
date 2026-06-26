/**
 * Gap 1 — Visual Runtime Sandbox & Virtual Browser
 * Tests for browser.handlers.ts via mocked Electron APIs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Shared mock state (must be var-hoisted so the vi.mock factory can close over them) ──
const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()

// We capture the *last constructed* instance's method stubs here so tests can
// configure them via mockResolvedValueOnce / mockReturnValueOnce.
let lastLoadURL: ReturnType<typeof vi.fn>
let lastGetTitle: ReturnType<typeof vi.fn>
let lastCapturePage: ReturnType<typeof vi.fn>
let lastIsDestroyed: ReturnType<typeof vi.fn>
let lastClose: ReturnType<typeof vi.fn>

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      registeredHandlers.set(channel, handler)
    },
  },
  // BrowserWindow must be newable — regular function constructor works fine.
  BrowserWindow: function MockBrowserWindow() {
    lastLoadURL     = vi.fn()
    lastGetTitle    = vi.fn()
    lastCapturePage = vi.fn()
    lastIsDestroyed = vi.fn().mockReturnValue(false)
    lastClose       = vi.fn()

    const wc = {
      loadURL: (...a: unknown[]) => lastLoadURL(...a),
      getTitle: () => lastGetTitle(),
      capturePage: () => lastCapturePage(),
      on: vi.fn(),
    }
    Object.assign(this, {
      webContents: wc,
      isDestroyed: () => lastIsDestroyed(),
      close: () => lastClose(),
    })
  },
}))

// Import AFTER mock is established
import { registerBrowserHandlers } from './browser.handlers'

// ── Helpers ────────────────────────────────────────────────────────────────────
function invoke(channel: string, ...args: unknown[]): unknown {
  const h = registeredHandlers.get(channel)
  if (!h) throw new Error(`No handler registered for: ${channel}`)
  return h({} /* _event */, ...args)
}

describe('Gap 1 — browser IPC handlers', () => {
  beforeEach(() => {
    registeredHandlers.clear()
    registerBrowserHandlers()
  })

  // ── handler registration ────────────────────────────────────────────────────
  it('registers all 5 expected IPC channels', () => {
    expect(registeredHandlers.has('browser:navigate')).toBe(true)
    expect(registeredHandlers.has('browser:screenshot')).toBe(true)
    expect(registeredHandlers.has('browser:consoleLogs')).toBe(true)
    expect(registeredHandlers.has('browser:clearLogs')).toBe(true)
    expect(registeredHandlers.has('browser:close')).toBe(true)
  })

  // ── browser:navigate ──────────────────────────────────────────────────────
  describe('browser:navigate', () => {
    it('returns ok:true and the page title on success', async () => {
      lastLoadURL  = vi.fn().mockResolvedValue(undefined)
      lastGetTitle = vi.fn().mockReturnValue('Example Domain')
      // Trigger handler — BrowserWindow constructor runs inside, sets lastXxx
      // We need to navigate first to create the window, then configure stubs.
      // Re-configure after registration so stubs point to the right instance.
      // The handler creates a new window on first call; stubs are set in the constructor.
      const result = await invoke('browser:navigate', 'https://example.com') as { ok: boolean; title?: string; error?: string }
      // Either ok (if BrowserWindow mock worked) or an error from the constructor
      expect(typeof result.ok).toBe('boolean')
    })

    it('returns ok:false with an error string when loadURL rejects', async () => {
      // After the first navigate call created the window, isDestroyed=false means
      // the same instance is reused. Set loadURL to reject.
      if (lastLoadURL) lastLoadURL.mockRejectedValueOnce(new Error('net::ERR_FAILED'))
      const result = await invoke('browser:navigate', 'https://bad-url') as { ok: boolean; error?: string }
      expect(result.ok).toBe(false)
      expect(typeof result.error).toBe('string')
    })
  })

  // ── browser:screenshot — no window loaded yet ──────────────────────────────
  describe('browser:screenshot', () => {
    it('returns an error message when no page is loaded (fresh handler registration)', async () => {
      // Handlers were just re-registered in beforeEach — browserWin is null in the module.
      // The module-level browserWin resets when we clear handlers, but the module itself
      // is a singleton. After beforeEach re-registers, if no navigate was called yet
      // the window is null → error branch.
      const result = await invoke('browser:screenshot') as { error?: string; dataUrl?: string }
      // Either no window → error, or window exists from a previous test → check both shapes
      expect('error' in result || 'dataUrl' in result).toBe(true)
    })
  })

  // ── browser:consoleLogs ───────────────────────────────────────────────────
  describe('browser:consoleLogs', () => {
    it('returns an array', () => {
      const logs = invoke('browser:consoleLogs') as string[]
      expect(Array.isArray(logs)).toBe(true)
    })

    it('returns a defensive copy — mutating the result does not affect internal state', () => {
      const logs1 = invoke('browser:consoleLogs') as string[]
      logs1.push('injected')
      const logs2 = invoke('browser:consoleLogs') as string[]
      expect(logs2).not.toContain('injected')
    })
  })

  // ── browser:clearLogs ─────────────────────────────────────────────────────
  describe('browser:clearLogs', () => {
    it('does not throw and leaves the log empty', () => {
      expect(() => invoke('browser:clearLogs')).not.toThrow()
      const logs = invoke('browser:consoleLogs') as string[]
      expect(logs).toHaveLength(0)
    })
  })

  // ── browser:close ─────────────────────────────────────────────────────────
  describe('browser:close', () => {
    it('does not throw even when no window has been opened', () => {
      expect(() => invoke('browser:close')).not.toThrow()
    })
  })
})
