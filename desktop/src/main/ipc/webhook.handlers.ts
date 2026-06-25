import { ipcMain } from 'electron'
import { startWebhookServer, stopWebhookServer, isWebhookServerRunning, getWebhookPort } from '../webhookServer'

export function registerWebhookHandlers(): void {
  ipcMain.handle('webhook:start', (): Promise<{ success: boolean; port?: number; error?: string }> => {
    return startWebhookServer()
  })

  ipcMain.handle('webhook:stop', (): boolean => {
    return stopWebhookServer()
  })

  ipcMain.handle('webhook:status', (): { running: boolean; port: number } => {
    return { running: isWebhookServerRunning(), port: getWebhookPort() }
  })
}
