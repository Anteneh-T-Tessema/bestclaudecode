import { ipcMain } from 'electron'
import { startAutonomousSession, stopAutonomousSession, getActiveSession } from '../agents/autonomousAgent'
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
}
