import { ipcMain } from 'electron'
import { startAutonomousSession, stopAutonomousSession, getActiveSession, replaySession, resolveApproval } from '../agents/autonomousAgent'
import { readEvents, listSessions } from '../agentEventLog'

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

  // Gap 54 — persisted event log read-back (audit / history view).
  ipcMain.handle('agent:listEventSessions', (): string[] => {
    return listSessions()
  })

  ipcMain.handle('agent:getEventLog', (_event, sessionId: string): Array<Record<string, unknown>> => {
    return readEvents(sessionId)
  })

  // Gap 51 — replay a past session's persisted event log at sped-up pacing.
  ipcMain.handle('agent:replay', async (_event, sessionId: string): Promise<boolean> => {
    return await replaySession(sessionId)
  })

  // Gap 57 — resolve a pending governance approval request.
  ipcMain.handle('agent:approve', (_event, sessionId: string, approved: boolean): boolean => {
    return resolveApproval(sessionId, approved)
  })
}
