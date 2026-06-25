import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getSecret, setSecret } from '../store'
import { startWebhookServer, getWebhookPort } from '../webhookServer'

export function registerCollabHandlers(): void {
  ipcMain.handle('collab:getInviteLink', async (_event, sessionId: string): Promise<string> => {
    let token = getSecret('collabToken')
    if (!token) {
      token = randomUUID()
      setSecret('collabToken', token)
    }
    // localhost only works for the host machine itself — sharing with a
    // genuinely remote teammate needs the host's LAN IP or a tunnel; out of
    // scope here (this feature is for "someone on this machine, or this LAN
    // with the right address, watches a session," not public sharing).
    const { port } = await startWebhookServer()
    return `http://localhost:${port ?? getWebhookPort()}/watch?session=${sessionId}&token=${token}`
  })
}
