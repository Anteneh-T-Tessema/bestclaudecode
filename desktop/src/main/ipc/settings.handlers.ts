import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { repoRoot, venvPython, venvPytest, venvRuff } from '../paths'
import { store, getSecret, setSecret } from '../store'
import { runPythonJson, runCommand, type PythonBridgeResult, type CommandResult } from '../pythonBridge'

// Mirrored from renderer/RunProposalCard.tsx — main process is the authoritative gate.
const MAIN_BLOCKED = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(\/|~|\$HOME|\$\{HOME\})/i,
  /:\(\)\s*\{\s*:|:\s*&\s*\}/,
  /dd\s+if=\/dev\/zero\s+of=\/dev\//i,
  /\bmkfs\b/i,
]

// Only these keys may be set via the public settings:set channel.
// Secret keys (API keys) are written via settings:setSecret (Gap 88 — safeStorage-encrypted).
const MUTABLE_KEYS = new Set([
  'theme', 'fontSize', 'sidebarWidth', 'rightPanelWidth',
  'bottomPanelHeight', 'projectPath', 'recentProjects', 'ollamaUrl', 'activeModel',
  'globalRules', 'wordWrap', 'minimap', 'tabSize', 'autoSave', 'stickyScroll', 'recentFiles',
])

interface EngineHealth {
  repoRoot: string
  pythonFound: boolean
  pytestFound: boolean
  ruffFound: boolean
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:checkEngine', (): EngineHealth => {
    return {
      repoRoot: repoRoot(),
      pythonFound: fs.existsSync(venvPython()),
      pytestFound: fs.existsSync(venvPytest()),
      ruffFound: fs.existsSync(venvRuff()),
    }
  })

  ipcMain.handle('settings:pythonBridgeCheck', (): Promise<PythonBridgeResult> => {
    return runPythonJson(['-m', 'src.decision_analytics', '--json'])
  })

  ipcMain.handle('settings:runTests', (): Promise<CommandResult> => {
    return runCommand(venvPytest(), ['src/tests/', '-q'])
  })

  ipcMain.handle('terminal:runCommand', (_, { command, cwd }: { command: string; cwd?: string }): Promise<CommandResult> => {
    if (MAIN_BLOCKED.some(re => re.test(command))) {
      throw new Error('Command blocked by Lakoora safety policy')
    }
    return runCommand('/bin/sh', ['-c', command], cwd ?? repoRoot())
  })

  // Fire-and-forget audit log — writes a decision log entry for each <<<RUN>>> execution.
  // Failures are logged to console but never surfaced to the user (run flow must not block on audit).
  ipcMain.handle('terminal:logRun', async (
    _,
    { command, cwd, exitCode, outputSnippet }: { command: string; cwd: string; exitCode: number; outputSnippet: string }
  ): Promise<void> => {
    try {
      const verdict = exitCode === 0 ? 'LGTM' : `Blocking: command failed (exit ${exitCode})`
      const outcome = `Exit ${exitCode} in ${cwd}. ${outputSnippet.slice(0, 160).replace(/\n/g, ' ')}`
      const task = `Run: ${command}`.slice(0, 80)
      const args = [
        '-m', 'src.decision_log', '--log',
        '--agent', 'lakoora-run',
        '--task', task,
        '--verdict', verdict,
        '--outcome', outcome,
        '--finding', `cwd: ${cwd}`,
      ]
      // In E2E tests, LAKOORA_DECISIONS_DIR points to an isolated fixture dir.
      // Pass --dir so the Python script writes there instead of docs/decisions/,
      // matching where decisions.handlers.ts reads from.
      if (process.env.LAKOORA_DECISIONS_DIR) {
        args.push('--dir', process.env.LAKOORA_DECISIONS_DIR)
      }
      await runCommand(venvPython(), args, repoRoot())
    } catch (e) { console.error('[logRun audit]', e) }
  })

  // electron-store-style settings persistence
  ipcMain.handle('settings:get', (_, key: string) => {
    return store.get(key)
  })

  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    // Support both (key, value) and ({ key, value }) calling conventions
    let resolvedKey = key
    let resolvedValue = value
    if (typeof key === 'object' && key !== null && 'key' in (key as object)) {
      const obj = key as { key: string; value: unknown }
      resolvedKey = obj.key
      resolvedValue = obj.value
    }
    if (!MUTABLE_KEYS.has(resolvedKey)) {
      throw new Error(`settings:set — key "${resolvedKey}" is not mutable via this channel`)
    }
    store.set(resolvedKey, resolvedValue)
    return { success: true }
  })

  ipcMain.handle('settings:exportSettings', async (): Promise<string | null> => {
    const { dialog } = await import('electron')
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Lakoora Settings',
      defaultPath: 'lakoora-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return null
    const exported: Record<string, unknown> = {}
    for (const key of MUTABLE_KEYS) {
      exported[key] = store.get(key)
    }
    fs.writeFileSync(filePath, JSON.stringify(exported, null, 2), 'utf-8')
    return filePath
  })

  ipcMain.handle('settings:importSettings', async (): Promise<string[] | null> => {
    const { dialog } = await import('electron')
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Lakoora Settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return null
    try {
      const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8')) as Record<string, unknown>
      const imported: string[] = []
      for (const key of MUTABLE_KEYS) {
        if (key in raw) {
          store.set(key, raw[key])
          imported.push(key)
        }
      }
      return imported
    } catch {
      return null
    }
  })

  ipcMain.handle('settings:validateKey', async (_, { provider, key }: { provider: 'anthropic' | 'openai'; key: string }): Promise<{ valid: boolean; error?: string }> => {
    try {
      if (provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const client = new Anthropic({ apiKey: key })
        await client.models.list()
        return { valid: true }
      } else if (provider === 'openai') {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey: key })
        await client.models.list()
        return { valid: true }
      }
      return { valid: false, error: 'Unknown provider' }
    } catch (err) {
      return { valid: false, error: (err as Error).message.slice(0, 80) }
    }
  })

  ipcMain.handle('settings:getAll', () => {
    // Only return non-secret keys. API keys are read individually via settings:getSecret.
    const result: Record<string, unknown> = {}
    for (const key of MUTABLE_KEYS) {
      result[key] = store.get(key)
    }
    return result
  })

  // Gap 88 — encrypted API key storage (safeStorage, OS-keychain-backed).
  ipcMain.handle('settings:setSecret', (_event, key: string, value: string): { success: boolean } => {
    try {
      setSecret(key, value)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('settings:getSecret', (_event, key: string): string => {
    try {
      return getSecret(key)
    } catch {
      return ''
    }
  })

  // Gap 81 — git diff context block: formats recent changes relative to a ref.
  ipcMain.handle('context:withDiff', async (_event, ref = 'HEAD'): Promise<{ text: string }> => {
    const result = await runCommand(venvPython(), ['-m', 'src.diff_context', ref, repoRoot()])
    const text = result.exitCode === 0 ? result.stdout.trim() : ''
    return { text }
  })

  // Gap 75 — cached repo orientation block: skips the full scan when source files
  // haven't changed since the last run (fingerprint-based cache in .context-cache/).
  ipcMain.handle('context:orientation', async (): Promise<{ text: string; cached: boolean }> => {
    const cacheDir = path.join(repoRoot(), '.context-cache')
    const hadCache = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).some((f) => f.endsWith('.json'))
    const result = await runCommand(venvPython(), ['-m', 'src.cached_context', repoRoot()])
    const text = result.exitCode === 0 ? result.stdout.trim() : ''
    const cached = hadCache
    return { text, cached }
  })

  // Gap 72 — context cache health: stats and LRU eviction for .context-cache/.
  ipcMain.handle('context:cacheStats', (): { total: number; bytes: number } => {
    const cacheDir = path.join(repoRoot(), '.context-cache')
    if (!fs.existsSync(cacheDir)) return { total: 0, bytes: 0 }
    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json'))
    const bytes = files.reduce((sum, f) => {
      try { return sum + fs.statSync(path.join(cacheDir, f)).size } catch { return sum }
    }, 0)
    return { total: files.length, bytes }
  })

  ipcMain.handle('context:evictCache', (_event, maxFiles = 0): { deleted: number } => {
    const cacheDir = path.join(repoRoot(), '.context-cache')
    if (!fs.existsSync(cacheDir)) return { deleted: 0 }
    const files = fs.readdirSync(cacheDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ filePath: path.join(cacheDir, f), mtime: fs.statSync(path.join(cacheDir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime)
    const toDelete = files.slice(0, Math.max(0, files.length - maxFiles))
    for (const { filePath } of toDelete) {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
    return { deleted: toDelete.length }
  })

}
