import { ipcMain } from 'electron'
import * as os from 'os'
import {
  startAutonomousSession, stopAutonomousSession, getActiveSession,
  replaySession, resolveApproval, getSessionDiff, exportReportHtml, exportReportPdf,
  runTestFixLoop,
} from '../agents/autonomousAgent'
import {
  readEvents, listSessions, verifyEventLog, computeComplianceSummary,
  type SessionSummary, type VerifyResult, type ComplianceSummary,
} from '../agentEventLog'

export function registerAgentHandlers(): void {
  ipcMain.handle(
    'agent:startAutonomous',
    async (_event, opts: { planFile: string; model: string }): Promise<string | null> => {
      try {
        return await startAutonomousSession(opts)
      } catch (err) {
        console.error('[agent:startAutonomous]', err)
        return null
      }
    },
  )

  ipcMain.handle('agent:stopAutonomous', (): void => {
    stopAutonomousSession()
  })

  ipcMain.handle('agent:getActiveSession', (): string | null => {
    return getActiveSession()
  })

  ipcMain.handle('agent:runTestFixLoop', async (_event, opts: { command: string; model: string }): Promise<string | null> => {
    try {
      return await runTestFixLoop(opts)
    } catch (err) {
      console.error('[agent:runTestFixLoop]', err)
      return null
    }
  })

  // Gap 54 — persisted event log read-back (audit / history view).
  ipcMain.handle('agent:listEventSessions', (): SessionSummary[] => {
    return listSessions()
  })

  ipcMain.handle('agent:getEventLog', (_event, sessionId: string): Array<Record<string, unknown>> => {
    return readEvents(sessionId)
  })

  // Gap 60 — verify a session's event log hasn't been tampered with.
  ipcMain.handle('agent:verifyEventLog', (_event, sessionId: string): VerifyResult => {
    return verifyEventLog(sessionId)
  })

  // Gap 51/68 — replay a past session's persisted event log at sped-up pacing.
  ipcMain.handle('agent:replay', async (_event, sessionId: string, speedup?: number): Promise<boolean> => {
    return await replaySession(sessionId, speedup)
  })

  // Gap 57/61 — resolve a pending governance approval request, recording the OS
  // user as the approver (there's no separate login system in this single-user app).
  ipcMain.handle('agent:approve', (_event, sessionId: string, approved: boolean): boolean => {
    return resolveApproval(sessionId, approved, os.userInfo().username)
  })

  // Gap 65 — recover the code diff a past session produced, even after its worktree was cleaned up.
  ipcMain.handle('agent:getSessionDiff', async (_event, branch: string): Promise<string> => {
    return await getSessionDiff(branch)
  })

  // Gap 64 — aggregate governance metrics across every recorded session.
  ipcMain.handle('agent:getComplianceSummary', (): ComplianceSummary => {
    return computeComplianceSummary()
  })

  // Gap 66 — render a session's verification report as standalone HTML.
  ipcMain.handle('agent:exportReportHtml', async (_event, sessionId: string): Promise<string | null> => {
    return await exportReportHtml(sessionId)
  })

  // Gap 76 — export the session report as PDF via Electron's built-in printToPDF.
  ipcMain.handle('agent:exportReportPdf', async (_event, sessionId: string): Promise<string | null> => {
    return await exportReportPdf(sessionId)
  })
}
