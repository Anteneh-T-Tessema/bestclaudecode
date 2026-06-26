import { ipcMain } from 'electron'
import { setHandoff, getHandoff, listHandoffs, clearHandoff } from '../agentHandoffStore'

export function registerHandoffHandlers(): void {
  ipcMain.handle('handoff:set', (_event, key: string, value: string): void => {
    setHandoff(key, value)
  })

  ipcMain.handle('handoff:get', (_event, key: string): string | null => {
    return getHandoff(key)
  })

  ipcMain.handle('handoff:list', (): Array<{ key: string; preview: string; writtenByRole: string | null; ts: number }> => {
    return listHandoffs()
  })

  ipcMain.handle('handoff:clear', (_event, key: string): boolean => {
    return clearHandoff(key)
  })
}
