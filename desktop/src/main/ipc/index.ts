import { ipcMain, BrowserWindow } from 'electron'
import { registerDecisionsHandlers } from './decisions.handlers'
import { registerSettingsHandlers } from './settings.handlers'
import { registerFsHandlers } from './fs.handlers'
import { registerTerminalHandlers } from './terminal.handlers'
import { registerGitHandlers } from './git.handlers'
import { registerAiHandlers } from './ai.handlers'
import { registerMemoryHandlers } from './memory.handlers'
import { registerSearchHandlers } from './search.handlers'
import { registerTaskPlannerHandlers } from './taskplanner.handlers'
import { registerLspHandlers } from './lsp.handlers'
import { registerArchDocHandlers } from './archDoc.handlers'
import { registerGithubHandlers } from './github.handlers'
import { registerSandboxHandlers } from './sandbox.handlers'
import { registerAgentHandlers } from './agent.handlers'
import { registerDapHandlers } from './dap.handlers'
import { registerMcpHandlers } from './mcp.handlers'
import { registerPolicyHandlers } from './policy.handlers'
import { registerDeployHandlers } from './deploy.handlers'
import { registerLinearHandlers } from './linear.handlers'
import { registerJiraHandlers } from './jira.handlers'
import { registerVoiceHandlers } from './voice.handlers'
import { registerDataAnalysisHandlers } from './dataAnalysis.handlers'
import { registerDesignHandlers } from './design.handlers'
import { registerHandoffHandlers } from './handoff.handlers'
import { registerNotificationsHandlers } from './notifications.handlers'
import { registerWizardHandlers } from './wizard.handlers'
import { registerWebhookHandlers } from './webhook.handlers'
import { registerMonitorHandlers } from './monitor.handlers'
import { registerIdeationHandlers } from './ideation.handlers'
import { registerCollabHandlers } from './collab.handlers'

export function registerAllIPC(): void {
  registerDecisionsHandlers()
  registerSettingsHandlers()
  registerFsHandlers()
  registerTerminalHandlers()
  registerGitHandlers()
  registerAiHandlers()
  registerMemoryHandlers()
  registerSearchHandlers()
  registerTaskPlannerHandlers()
  registerLspHandlers()
  registerArchDocHandlers()
  registerGithubHandlers()
  registerSandboxHandlers()
  registerAgentHandlers()
  registerDapHandlers()
  registerMcpHandlers()
  registerPolicyHandlers()
  registerDeployHandlers()
  registerLinearHandlers()
  registerJiraHandlers()
  registerVoiceHandlers()
  registerDataAnalysisHandlers()
  registerDesignHandlers()
  registerHandoffHandlers()
  registerNotificationsHandlers()
  registerWizardHandlers()
  registerWebhookHandlers()
  registerMonitorHandlers()
  registerIdeationHandlers()
  registerCollabHandlers()

  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })
}
