import { ipcMain } from 'electron'
import { startAutonomousSession, stopAutonomousSession, getActiveSession } from '../agents/autonomousAgent'

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
}
