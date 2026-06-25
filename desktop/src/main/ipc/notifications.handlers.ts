import { ipcMain } from 'electron'
import { getSecret } from '../store'

async function postToSlack(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    return resp.ok
  } catch {
    return false
  }
}

export async function sendNotification(text: string): Promise<void> {
  const webhookUrl = getSecret('slackWebhookUrl')
  if (!webhookUrl) return
  postToSlack(webhookUrl, text).catch(() => {})
}

export function registerNotificationsHandlers(): void {
  ipcMain.handle('notifications:send', async (_event, opts: { text: string }): Promise<boolean> => {
    const webhookUrl = getSecret('slackWebhookUrl')
    if (!webhookUrl) return false
    return postToSlack(webhookUrl, opts.text)
  })
}
