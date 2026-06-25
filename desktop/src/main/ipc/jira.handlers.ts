import { ipcMain } from 'electron'
import { getSecret, store } from '../store'
import type { ExternalIssue } from './linear.handlers'

interface AdfNode {
  type?: string
  text?: string
  content?: AdfNode[]
}

function extractAdfText(node: AdfNode): string {
  if (node.type === 'text' && node.text) return node.text
  if (node.content) return node.content.map(extractAdfText).join('')
  return ''
}

export function registerJiraHandlers(): void {
  ipcMain.handle('jira:getIssue', async (_event, issueKey: string): Promise<ExternalIssue | null> => {
    const baseUrl = store.get('jiraBaseUrl') as string | undefined
    const email = store.get('jiraEmail') as string | undefined
    const token = getSecret('jiraApiToken')
    if (!baseUrl || !email || !token) return null

    try {
      const auth = Buffer.from(`${email}:${token}`).toString('base64')
      const resp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}?fields=summary,description,status,comment`, {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      })
      if (!resp.ok) return null
      const json = await resp.json() as {
        key: string
        fields: {
          summary: string
          status?: { name: string }
          description?: AdfNode
          comment?: { comments: Array<{ body?: AdfNode; author?: { displayName: string } }> }
        }
      }
      const f = json.fields
      const description = f.description ? extractAdfText(f.description) : ''
      const comments = (f.comment?.comments ?? []).map((c) => ({
        author: c.author?.displayName ?? 'unknown',
        body: c.body ? extractAdfText(c.body) : '',
      }))
      return {
        key: json.key,
        title: f.summary,
        description,
        status: f.status?.name ?? '',
        url: `${baseUrl}/browse/${json.key}`,
        comments,
      }
    } catch {
      return null
    }
  })
}
