import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import * as path from 'path'
import { store } from '../store'
import { repoRoot } from '../paths'
import { detectDeployCommand, runDeploy, runPreviewDeploy, promoteDeploy, rollbackDeploy, providerFromCommand } from '../deploy'
import { appendDeployRecord, listDeployRecords, type DeployRecord } from '../deployHistory'
import { broadcast, getActiveSessions } from '../agents/autonomousAgent'

// Gap 140 — manual, user-triggered deploy, distinct from the autonomous
// agent's automatic end-of-session deploy (autonomousAgent.ts's
// attemptDeploy()). Shares detection/run logic via ../deploy and reuses the
// same agent:progress broadcast channel + AgentProgressPanel UI so a manual
// deploy gets the exact same deploying/deployed/error display for free.

function projectRoot(): string {
  return path.resolve((store.get('projectPath') as string | undefined) || repoRoot())
}

export function registerDeployHandlers(): void {
  ipcMain.handle('deploy:detect', async (): Promise<string | null> => {
    return detectDeployCommand(projectRoot())
  })

  ipcMain.handle('deploy:run', async (): Promise<{ success: boolean; deployUrl?: string; error?: string }> => {
    // Gap 140 — block manual deploys while an autonomous agent session is active:
    // both would otherwise interleave on the same agent:progress channel that
    // AgentProgressPanel renders as one unfiltered, unsessioned status banner.
    if (getActiveSessions().length > 0) {
      return { success: false, error: 'An agent session is currently running — wait for it to finish before deploying manually.' }
    }

    const targetPath = projectRoot()
    const sessionId = `manual-deploy-${Date.now()}`
    const deployCmd = await detectDeployCommand(targetPath)
    if (!deployCmd) {
      return { success: false, error: 'No deploy configuration found (no package.json "deploy" script, vercel.json, or netlify.toml)' }
    }
    const provider = providerFromCommand(deployCmd)
    // Vercel/Netlify default to a PREVIEW deploy now — production requires an
    // explicit Promote (see deploy:promote). npm-script projects have no
    // preview concept, so they keep the original direct-to-prod behavior.
    const target: 'preview' | 'production' = provider === 'npm' ? 'production' : 'preview'

    broadcast({
      sessionId, planFile: '', subtaskId: '', subtaskDescription: `Running ${deployCmd}…`,
      status: 'deploying', doneCount: 0, totalCount: 0,
    })

    try {
      const { exitCode, stderr, stdout, deployUrl } = target === 'preview'
        ? await runPreviewDeploy(targetPath, provider as 'vercel' | 'netlify')
        : await runDeploy(targetPath, deployCmd)
      if (exitCode !== 0) {
        const error = stderr || stdout || `Deploy command exited with code ${exitCode}`
        broadcast({
          sessionId, planFile: '', subtaskId: '', subtaskDescription: '',
          status: 'error', error, doneCount: 0, totalCount: 0,
        })
        appendDeployRecord(targetPath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target, exitCode, url: undefined })
        return { success: false, error }
      }
      broadcast({
        sessionId, planFile: '', subtaskId: '', subtaskDescription: '',
        status: 'deployed', doneCount: 0, totalCount: 0, deployUrl,
      })
      appendDeployRecord(targetPath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target, exitCode, url: deployUrl })
      return { success: true, deployUrl }
    } catch (err) {
      const error = String(err)
      broadcast({
        sessionId, planFile: '', subtaskId: '', subtaskDescription: '',
        status: 'error', error, doneCount: 0, totalCount: 0,
      })
      return { success: false, error }
    }
  })

  ipcMain.handle('deploy:history', async (): Promise<DeployRecord[]> => {
    return listDeployRecords(projectRoot())
  })

  ipcMain.handle('deploy:promote', async (_event, deployId: string): Promise<{ success: boolean; deployUrl?: string; error?: string }> => {
    if (getActiveSessions().length > 0) {
      return { success: false, error: 'An agent session is currently running — wait for it to finish before deploying manually.' }
    }
    const targetPath = projectRoot()
    const record = listDeployRecords(targetPath).find((r) => r.id === deployId)
    if (!record || record.provider === 'npm') {
      return { success: false, error: 'No promotable preview deployment found' }
    }
    const sessionId = `manual-deploy-${Date.now()}`
    broadcast({ sessionId, planFile: '', subtaskId: '', subtaskDescription: 'Promoting to production…', status: 'deploying', doneCount: 0, totalCount: 0 })
    const { exitCode, stderr, stdout, deployUrl } = await promoteDeploy(targetPath, record.provider, record.url ?? '')
    if (exitCode !== 0) {
      const error = stderr || stdout || `Promote exited with code ${exitCode}`
      broadcast({ sessionId, planFile: '', subtaskId: '', subtaskDescription: '', status: 'error', error, doneCount: 0, totalCount: 0 })
      return { success: false, error }
    }
    broadcast({ sessionId, planFile: '', subtaskId: '', subtaskDescription: '', status: 'deployed', doneCount: 0, totalCount: 0, deployUrl })
    appendDeployRecord(targetPath, {
      id: randomUUID(), ts: Date.now(), provider: record.provider, deployCmd: record.deployCmd,
      target: 'production', exitCode, url: deployUrl, promotedFromId: deployId,
    })
    return { success: true, deployUrl }
  })

  ipcMain.handle('deploy:rollback', async (_event, deployId: string): Promise<{ success: boolean; error?: string }> => {
    if (getActiveSessions().length > 0) {
      return { success: false, error: 'An agent session is currently running — wait for it to finish before deploying manually.' }
    }
    const targetPath = projectRoot()
    const record = listDeployRecords(targetPath).find((r) => r.id === deployId)
    if (!record || record.provider !== 'vercel') {
      return { success: false, error: 'Rollback is only available for Vercel deployments' }
    }
    const sessionId = `manual-deploy-${Date.now()}`
    broadcast({ sessionId, planFile: '', subtaskId: '', subtaskDescription: 'Rolling back…', status: 'deploying', doneCount: 0, totalCount: 0 })
    const { exitCode, stderr, stdout } = await rollbackDeploy(targetPath, record.url ?? '')
    if (exitCode !== 0) {
      const error = stderr || stdout || `Rollback exited with code ${exitCode}`
      broadcast({ sessionId, planFile: '', subtaskId: '', subtaskDescription: '', status: 'error', error, doneCount: 0, totalCount: 0 })
      return { success: false, error }
    }
    broadcast({ sessionId, planFile: '', subtaskId: '', subtaskDescription: '', status: 'deployed', doneCount: 0, totalCount: 0, deployUrl: record.url })
    appendDeployRecord(targetPath, {
      id: randomUUID(), ts: Date.now(), provider: record.provider, deployCmd: record.deployCmd,
      target: 'production', exitCode, url: record.url, rolledBackFromId: deployId,
    })
    return { success: true }
  })
}
