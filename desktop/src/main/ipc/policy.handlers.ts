import { ipcMain } from 'electron'
import { checkCommand, checkPath, checkApproval, type PolicyConfig, type PolicyViolation } from '../policyEngine'

export interface PolicyTestOpts {
  kind: 'command' | 'path' | 'approval'
  value: string
  config: PolicyConfig
}

/**
 * Gap 67 — dry-run a policy rule against a sample value without running a real
 * agent session. Tests the config the caller is currently editing (not what's
 * saved to disk), so a user can check a draft before saving it.
 */
export function registerPolicyHandlers(): void {
  ipcMain.handle('policy:test', (_event, opts: PolicyTestOpts): PolicyViolation | null => {
    const { kind, value, config } = opts
    if (kind === 'command') return checkCommand(config, value)
    if (kind === 'path') return checkPath(config, value)
    return checkApproval(config, value)
  })
}
