import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import * as path from 'path'
import { promises as fsp } from 'fs'
import { store } from '../store'
import { repoRoot } from '../paths'
import { runCommand } from '../pythonBridge'
import { detectDeployCommand, runDeploy, runPreviewDeploy, promoteDeploy, rollbackDeploy, providerFromCommand } from '../deploy'
import { appendDeployRecord, listDeployRecords, type DeployRecord } from '../deployHistory'
import { broadcast, getActiveSessions, streamToString, runDeployFixLoop } from '../agents/autonomousAgent'
import { redactSecrets } from '../secretPatterns'

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

  ipcMain.handle(
    'deploy:runWithChecks',
    async (_event, opts: { model?: string }): Promise<{ success: boolean; deployUrl?: string; error?: string; findings?: Array<{ severity: string; file: string; message: string }> }> => {
      if (getActiveSessions().length > 0) {
        return { success: false, error: 'An agent session is currently running — wait for it to finish before deploying manually.' }
      }

      const targetPath = projectRoot()
      const sessionId = `manual-deploy-${Date.now()}`
      const model = opts?.model || (store.get('activeModel') as string) || 'claude-sonnet-4-6'
      const deployCmd = await detectDeployCommand(targetPath)
      if (!deployCmd) {
        return { success: false, error: 'No deploy configuration found (no package.json "deploy" script, vercel.json, .vercel, netlify.toml, .netlify, cdk.json, or k8s/kubernetes directory)' }
      }
      const provider = providerFromCommand(deployCmd)
      const target: 'preview' | 'production' = provider === 'npm' ? 'production' : 'preview'

      const hitlDeployment = store.get('hitlDeployment') as string
      if (hitlDeployment === 'confirm') {
        const { dialog } = await import('electron')
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          buttons: ['Yes, Deploy', 'Cancel'],
          defaultId: 1,
          title: 'Confirm Deployment',
          message: `Are you sure you want to run the deployment command: ${deployCmd}?`,
          detail: 'This will release the active changes to production/preview.',
        })
        if (choice === 1) {
          return { success: false, error: 'Deployment cancelled by user.' }
        }
      }

      // 1. Run Tests Pre-flight
      broadcast({ sessionId, planFile: '', subtaskId: 'deploy-preflight', subtaskDescription: '🧪 Running pre-flight unit tests…', status: 'deploying', doneCount: 0, totalCount: 2 })
      
      let testCmd = ''
      try {
        const raw = await fsp.readFile(path.join(targetPath, 'package.json'), 'utf-8')
        const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
        if (pkg.scripts?.test) {
          testCmd = 'npm test'
        }
      } catch { /* no package.json or no scripts */ }

      if (!testCmd) {
        // Check python pytest
        try {
          await fsp.access(path.join(targetPath, '.venv/bin/pytest'))
          testCmd = '.venv/bin/pytest src/tests/ -q'
        } catch { /* no pytest */ }
      }

      if (testCmd) {
        try {
          const testResult = await runCommand('/bin/sh', ['-c', testCmd], targetPath)
          if (testResult.exitCode !== 0) {
            const error = `Tests failed (exit code ${testResult.exitCode}). Fix test failures before deploying.`
            broadcast({ sessionId, planFile: '', subtaskId: 'deploy-preflight', subtaskDescription: '', status: 'error', error, doneCount: 0, totalCount: 2 })
            return { success: false, error }
          }
        } catch (err) {
          const error = `Failed to run tests: ${String(err)}`
          broadcast({ sessionId, planFile: '', subtaskId: 'deploy-preflight', subtaskDescription: '', status: 'error', error, doneCount: 0, totalCount: 2 })
          return { success: false, error }
        }
      }

      // 2. AI Code Review Pre-flight
      broadcast({ sessionId, planFile: '', subtaskId: 'deploy-preflight', subtaskDescription: '🤖 Running AI code review on local changes…', status: 'deploying', doneCount: 1, totalCount: 2 })
      
      let diff = ''
      try {
        const staged = await runCommand('git', ['diff', '--cached'], targetPath)
        const unstaged = await runCommand('git', ['diff'], targetPath)
        diff = (staged.stdout + '\n' + unstaged.stdout).trim()
      } catch { /* git diff error, skip review */ }

      if (diff) {
        try {
          const reviewResponse = await streamToString([
            {
              role: 'system',
              content: 'You are an automated security and functional code reviewer. Respond ONLY with a JSON object. The JSON must have: "findings" (array of {severity: "error" | "warning", file: string, message: string}) and "summary" (string). If no issues are found, return an empty findings array. Avoid code blocks or markdown wrappers; return raw JSON only.'
            },
            {
              role: 'user',
              content: `Review this diff for security flaws, credentials leakage, or syntax errors before deployment:\n\n${diff.slice(0, 8000)}`
            }
          ], model, new AbortController().signal)

          let cleaned = reviewResponse.trim()
          if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '')
          }
          const parsed = JSON.parse(cleaned) as { findings?: Array<{ severity: 'error' | 'warning'; file: string; message: string }>; summary?: string }
          
          const errors = parsed.findings?.filter(f => f.severity === 'error') || []
          if (errors.length > 0) {
            // Redacted before this IPC handler returns it directly to the
            // renderer — broadcast() redacts its own copy internally, but
            // that doesn't reach this function's `return`, which bypasses
            // broadcast entirely. The model is reviewing a diff, so its
            // findings can legitimately quote a leaked secret back at us.
            const error = redactSecrets(`Deploy blocked by AI Code Reviewer. Critical issues found in files: ${errors.map(e => e.file).join(', ')}. Detail: ${errors[0].message}`)
            const redactedFindings = parsed.findings?.map((f) => ({ ...f, message: redactSecrets(f.message) }))
            broadcast({ sessionId, planFile: '', subtaskId: 'deploy-preflight', subtaskDescription: '', status: 'error', error, doneCount: 1, totalCount: 2 })
            return { success: false, error, findings: redactedFindings }
          }
        } catch (err) {
          console.warn('[deploy preflight] Code review failed or JSON parse error:', err)
        }
      }

      // 3. Run deploy command
      broadcast({
        sessionId, planFile: '', subtaskId: 'deploy-run', subtaskDescription: `Running ${deployCmd}…`,
        status: 'deploying', doneCount: 2, totalCount: 2,
      })

      try {
        const { exitCode, stderr, stdout, deployUrl } = target === 'preview'
          ? await runPreviewDeploy(targetPath, provider as 'vercel' | 'netlify')
          : await runDeploy(targetPath, deployCmd)
        
        if (exitCode !== 0) {
          const initialError = stderr || stdout || `Deploy command exited with code ${exitCode}`
          broadcast({
            sessionId, planFile: '', subtaskId: 'deploy-run', subtaskDescription: '',
            status: 'error', error: initialError, doneCount: 2, totalCount: 2,
          })
          appendDeployRecord(targetPath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target, exitCode, url: undefined })

          // Deploy self-healing — diagnose the failure with AI, apply fixes,
          // retry within a bounded budget before reporting failure.
          const healed = await runDeployFixLoop({ sessionId, targetPath, deployCmd, provider, target, model, initialError })
          if (healed.success) {
            broadcast({
              sessionId, planFile: '', subtaskId: 'deploy-run', subtaskDescription: '',
              status: 'deployed', doneCount: 2, totalCount: 2, deployUrl: healed.deployUrl,
            })
            appendDeployRecord(targetPath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target, exitCode: 0, url: healed.deployUrl, selfHealed: true })
            return { success: true, deployUrl: healed.deployUrl }
          }
          return { success: false, error: healed.error }
        }

        broadcast({
          sessionId, planFile: '', subtaskId: 'deploy-run', subtaskDescription: '',
          status: 'deployed', doneCount: 2, totalCount: 2, deployUrl,
        })
        appendDeployRecord(targetPath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target, exitCode, url: deployUrl })
        return { success: true, deployUrl }
      } catch (err) {
        const error = String(err)
        broadcast({
          sessionId, planFile: '', subtaskId: 'deploy-run', subtaskDescription: '',
          status: 'error', error, doneCount: 2, totalCount: 2,
        })
        return { success: false, error }
      }
    }
  )

  ipcMain.handle('deploy:run', async (): Promise<{ success: boolean; deployUrl?: string; error?: string }> => {
    // Gap 140 — block manual deploys while an autonomous agent session is active:
    // both would otherwise interleave on the same agent:progress channel that
    // AgentProgressPanel renders as one unfiltered, unsessioned status banner.
    if (getActiveSessions().length > 0) {
      return { success: false, error: 'An agent session is currently running — wait for it to finish before deploying manually.' }
    }

    const targetPath = projectRoot()
    const sessionId = `manual-deploy-${Date.now()}`
    const model = (store.get('activeModel') as string) || 'claude-sonnet-4-6'
    const deployCmd = await detectDeployCommand(targetPath)
    if (!deployCmd) {
      return { success: false, error: 'No deploy configuration found (no package.json "deploy" script, vercel.json, or netlify.toml)' }
    }
    const provider = providerFromCommand(deployCmd)
    // Vercel/Netlify default to a PREVIEW deploy now — production requires an
    // explicit Promote (see deploy:promote). npm-script projects have no
    // preview concept, so they keep the original direct-to-prod behavior.
    const target: 'preview' | 'production' = provider === 'npm' ? 'production' : 'preview'

    const hitlDeployment = store.get('hitlDeployment') as string
    if (hitlDeployment === 'confirm') {
      const { dialog } = await import('electron')
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['Yes, Deploy', 'Cancel'],
        defaultId: 1,
        title: 'Confirm Deployment',
        message: `Are you sure you want to run the deployment command: ${deployCmd}?`,
        detail: 'This will release the active changes to production/preview.',
      })
      if (choice === 1) {
        return { success: false, error: 'Deployment cancelled by user.' }
      }
    }

    broadcast({
      sessionId, planFile: '', subtaskId: '', subtaskDescription: `Running ${deployCmd}…`,
      status: 'deploying', doneCount: 0, totalCount: 0,
    })

    try {
      const { exitCode, stderr, stdout, deployUrl } = target === 'preview'
        ? await runPreviewDeploy(targetPath, provider as 'vercel' | 'netlify')
        : await runDeploy(targetPath, deployCmd)
      if (exitCode !== 0) {
        const initialError = stderr || stdout || `Deploy command exited with code ${exitCode}`
        broadcast({
          sessionId, planFile: '', subtaskId: '', subtaskDescription: '',
          status: 'error', error: initialError, doneCount: 0, totalCount: 0,
        })
        appendDeployRecord(targetPath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target, exitCode, url: undefined })

        // Deploy self-healing — diagnose the failure with AI, apply fixes,
        // retry within a bounded budget before reporting failure.
        const healed = await runDeployFixLoop({ sessionId, targetPath, deployCmd, provider, target, model, initialError })
        if (healed.success) {
          broadcast({
            sessionId, planFile: '', subtaskId: '', subtaskDescription: '',
            status: 'deployed', doneCount: 0, totalCount: 0, deployUrl: healed.deployUrl,
          })
          appendDeployRecord(targetPath, { id: randomUUID(), ts: Date.now(), provider, deployCmd, target, exitCode: 0, url: healed.deployUrl, selfHealed: true })
          return { success: true, deployUrl: healed.deployUrl }
        }
        return { success: false, error: healed.error }
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
    if (!record || (record.provider !== 'vercel' && record.provider !== 'netlify')) {
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
