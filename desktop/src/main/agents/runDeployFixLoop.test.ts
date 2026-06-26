/**
 * Deploy self-healing — control-flow tests for runDeployFixLoop's
 * diagnose-edit-retry loop. Mirrors the loop shape in autonomousAgent.ts
 * exactly (same pattern as swarmRoles.test.ts/noActionGuard.test.ts) with
 * injectable fake deploy/AI/edit functions, rather than importing the
 * orchestrator module directly — it pulls in electron + a dozen
 * main-process singletons that would all need mocking just to import it.
 */
import { describe, it, expect, vi } from 'vitest'

interface EditBlock { path: string; content: string }
interface DeployResult { exitCode: number; stderr?: string; stdout?: string; deployUrl?: string }

interface FixLoopDeps {
  maxRetries: number
  streamToString: (prompt: string) => Promise<string>
  parseEdits: (response: string) => EditBlock[]
  applyEdit: (edit: EditBlock) => Promise<void>
  runDeploy: () => Promise<DeployResult>
}

// Mirrors runDeployFixLoop's loop body in autonomousAgent.ts exactly, with
// its concrete dependencies (streamToString/parseEdits/applyEdit/runDeploy)
// passed in instead of imported, so the control flow can be tested without
// mocking electron/pythonBridge/policyEngine/etc.
async function runDeployFixLoop(
  initialError: string,
  deps: FixLoopDeps,
): Promise<{ success: boolean; deployUrl?: string; error?: string }> {
  let lastError = initialError
  for (let retryCount = 0; retryCount < deps.maxRetries; retryCount++) {
    const response = await deps.streamToString(lastError)
    const edits = deps.parseEdits(response)
    if (edits.length === 0) break

    for (const edit of edits) {
      try { await deps.applyEdit(edit) } catch { /* ignore single-file failure, continue with others */ }
    }

    const { exitCode, stderr, stdout, deployUrl } = await deps.runDeploy()
    if (exitCode === 0) return { success: true, deployUrl }
    lastError = stderr || stdout || `Deploy command exited with code ${exitCode}`
  }
  return { success: false, error: `Auto-fix exhausted ${deps.maxRetries} attempt(s) — last error: ${lastError}` }
}

function fakeDeps(overrides: Partial<FixLoopDeps> = {}): FixLoopDeps {
  return {
    maxRetries: 3,
    streamToString: vi.fn().mockResolvedValue('<<<EDIT a.ts>>>\nfixed\n<<<END_EDIT>>>'),
    parseEdits: () => [{ path: 'a.ts', content: 'fixed' }],
    applyEdit: vi.fn().mockResolvedValue(undefined),
    runDeploy: vi.fn().mockResolvedValue({ exitCode: 0, deployUrl: 'https://example.com' }),
    ...overrides,
  }
}

describe('runDeployFixLoop', () => {
  it('succeeds on the first retry when the fix resolves the failure', async () => {
    const deps = fakeDeps()
    const result = await runDeployFixLoop('initial failure', deps)
    expect(result).toEqual({ success: true, deployUrl: 'https://example.com' })
    expect(deps.applyEdit).toHaveBeenCalledTimes(1)
    expect(deps.runDeploy).toHaveBeenCalledTimes(1)
  })

  it('retries up to maxRetries and returns the last error on exhaustion', async () => {
    const runDeploy = vi.fn().mockResolvedValue({ exitCode: 1, stderr: 'still broken' })
    const deps = fakeDeps({ maxRetries: 3, runDeploy })
    const result = await runDeployFixLoop('initial failure', deps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('exhausted 3 attempt(s)')
    expect(result.error).toContain('still broken')
    expect(runDeploy).toHaveBeenCalledTimes(3)
  })

  it('stops immediately without retrying the deploy when AI returns no edits', async () => {
    const runDeploy = vi.fn()
    const deps = fakeDeps({ parseEdits: () => [], runDeploy })
    const result = await runDeployFixLoop('initial failure', deps)
    expect(result.success).toBe(false)
    expect(runDeploy).not.toHaveBeenCalled()
  })

  it('continues applying remaining edits after one edit fails to apply', async () => {
    const applyEdit = vi.fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined)
    const deps = fakeDeps({
      parseEdits: () => [{ path: 'a.ts', content: 'x' }, { path: 'b.ts', content: 'y' }],
      applyEdit,
    })
    const result = await runDeployFixLoop('initial failure', deps)
    expect(applyEdit).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(true)
  })

  it('succeeds on a later retry after an earlier one still fails', async () => {
    const runDeploy = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'attempt 1 failed' })
      .mockResolvedValueOnce({ exitCode: 0, deployUrl: 'https://fixed.example.com' })
    const deps = fakeDeps({ runDeploy })
    const result = await runDeployFixLoop('initial failure', deps)
    expect(result).toEqual({ success: true, deployUrl: 'https://fixed.example.com' })
    expect(runDeploy).toHaveBeenCalledTimes(2)
  })

  it('returns failure immediately when maxRetries is 0', async () => {
    const runDeploy = vi.fn()
    const deps = fakeDeps({ maxRetries: 0, runDeploy })
    const result = await runDeployFixLoop('initial failure', deps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('exhausted 0 attempt(s)')
    expect(runDeploy).not.toHaveBeenCalled()
  })
})
