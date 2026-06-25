import { ipcMain } from 'electron'
import { getSecret } from '../store'

export interface ExternalIssue {
  key: string
  title: string
  description: string
  status: string
  url: string
  comments: Array<{ author: string; body: string }>
}

export function registerLinearHandlers(): void {
  ipcMain.handle('linear:getIssue', async (_event, issueId: string): Promise<ExternalIssue | null> => {
    const apiKey = getSecret('linearApiKey')
    if (!apiKey) return null

    try {
      const query = `
        query($id: String!) {
          issue(id: $id) {
            identifier title description
            state { name }
            url
            comments { nodes { body user { name } } }
          }
        }
      `
      const resp = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables: { id: issueId } }),
      })
      if (!resp.ok) return null
      const json = await resp.json() as { data?: { issue?: Record<string, unknown> } }
      const issue = json.data?.issue
      if (!issue) return null
      const comments = (issue.comments as { nodes: Array<{ body: string; user?: { name: string } }> } | undefined)
      return {
        key: issue.identifier as string,
        title: issue.title as string,
        description: (issue.description as string | null | undefined) ?? '',
        status: (issue.state as { name: string } | undefined)?.name ?? '',
        url: issue.url as string,
        comments: (comments?.nodes ?? []).map((c) => ({
          author: c.user?.name ?? 'unknown',
          body: c.body,
        })),
      }
    } catch {
      return null
    }
  })
}
