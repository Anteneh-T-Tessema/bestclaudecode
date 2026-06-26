import { ipcMain } from 'electron'
import { runPythonJson } from '../pythonBridge'
import { repoRoot } from '../paths'
import { scanSandboxFiles } from '../sandboxScanner'

export interface ShadowInfo {
  id: string
  path: string
  branch: string
  base_ref: string
  repo_root: string
}

// In-process registry: shadow id → ShadowInfo (survives across IPC calls)
const shadows = new Map<string, ShadowInfo>()

export function registerSandboxHandlers(): void {
  ipcMain.handle('agent:createShadow', async (_event, baseRef = 'HEAD'): Promise<ShadowInfo | null> => {
    const result = await runPythonJson(['-m', 'src.shadow_workspace', 'create', baseRef, '--json'])
    if (!result.ok) return null
    const info = result.stats as ShadowInfo
    shadows.set(info.id, info)
    return info
  })

  ipcMain.handle('agent:getShadowDiff', async (_event, shadowId: string): Promise<string | null> => {
    const info = shadows.get(shadowId)
    if (!info) return null
    const result = await runPythonJson(['-m', 'src.shadow_workspace', 'diff', info.path, '--json'])
    if (!result.ok) return null
    return (result.stats as { diff: string }).diff ?? ''
  })

  ipcMain.handle('agent:getShadowDiffVsBase', async (_event, shadowId: string): Promise<string | null> => {
    const info = shadows.get(shadowId)
    if (!info) return null
    const result = await runPythonJson(['-m', 'src.shadow_workspace', 'diff-vs-base', info.path, '--json'])
    if (!result.ok) return null
    return (result.stats as { diff: string }).diff ?? ''
  })

  ipcMain.handle('agent:promoteShadow', async (_event, shadowId: string): Promise<boolean> => {
    const info = shadows.get(shadowId)
    if (!info) return false

    // Run quality & security scans
    const findings = scanSandboxFiles(info.path, info.base_ref)
    if (findings.length > 0) {
      const summary = findings.map(f => `- [${f.type.toUpperCase()}] ${f.message}`).join('\n')
      throw new Error(`Promotion blocked by quality/security guardrails:\n${summary}`)
    }

    const result = await runPythonJson([
      '-m', 'src.shadow_workspace', 'promote', info.path, repoRoot(), '--json',
    ])
    if (!result.ok) return false
    shadows.delete(shadowId)
    return true
  })

  ipcMain.handle('agent:discardShadow', async (_event, shadowId: string): Promise<boolean> => {
    const info = shadows.get(shadowId)
    if (!info) return false
    const result = await runPythonJson([
      '-m', 'src.shadow_workspace', 'discard', info.path, repoRoot(), '--json',
    ])
    if (!result.ok) return false
    shadows.delete(shadowId)
    return true
  })
}
