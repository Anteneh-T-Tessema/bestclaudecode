import { ipcMain } from 'electron'
import * as path from 'path'
import { store } from '../store'
import { repoRoot } from '../paths'
import { detectDeployCommand, runDeploy } from '../deploy'
import { broadcast, getActiveSession } from '../agents/autonomousAgent'

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
    if (getActiveSession()) {
      return { success: false, error: 'An agent session is currently running — wait for it to finish before deploying manually.' }
    }

    const targetPath = projectRoot()
    const sessionId = `manual-deploy-${Date.now()}`
    const deployCmd = await detectDeployCommand(targetPath)
    if (!deployCmd) {
      return { success: false, error: 'No deploy configuration found (no package.json "deploy" script, vercel.json, or netlify.toml)' }
    }

    broadcast({
      sessionId, planFile: '', subtaskId: '', subtaskDescription: `Running ${deployCmd}…`,
      status: 'deploying', doneCount: 0, totalCount: 0,
    })

    try {
      const { exitCode, stderr, stdout, deployUrl } = await runDeploy(targetPath, deployCmd)
      if (exitCode !== 0) {
        const error = stderr || stdout || `Deploy command exited with code ${exitCode}`
        broadcast({
          sessionId, planFile: '', subtaskId: '', subtaskDescription: '',
          status: 'error', error, doneCount: 0, totalCount: 0,
        })
        return { success: false, error }
      }
      broadcast({
        sessionId, planFile: '', subtaskId: '', subtaskDescription: '',
        status: 'deployed', doneCount: 0, totalCount: 0, deployUrl,
      })
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
}
