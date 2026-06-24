/**
 * MCP server configuration + connection lifecycle, exposed to the Settings
 * panel. Tool aggregation/dispatch for the chat tool-calling loop lives in
 * mcpManager.ts and is consumed directly by ai.handlers.ts (no IPC needed
 * there since both run in the main process).
 */
import { ipcMain } from 'electron'
import {
  listServerStatuses,
  addServerConfig,
  removeServerConfig,
  connectServer,
  disconnectServer,
  connectAllServers,
  type McpServerConfig,
  type McpServerStatus,
} from '../mcp/mcpManager'

export function registerMcpHandlers(): void {
  ipcMain.handle('mcp:listServers', (): McpServerStatus[] => listServerStatuses())

  ipcMain.handle(
    'mcp:addServer',
    (_, opts: { name: string; command: string; args: string[] }): McpServerConfig =>
      addServerConfig(opts)
  )

  ipcMain.handle('mcp:removeServer', async (_, id: string): Promise<void> => {
    await removeServerConfig(id)
  })

  ipcMain.handle(
    'mcp:connect',
    async (_, id: string): Promise<{ success: boolean; error?: string; toolCount?: number }> =>
      connectServer(id)
  )

  ipcMain.handle('mcp:disconnect', async (_, id: string): Promise<void> => {
    await disconnectServer(id)
  })

  // Best-effort: bring up every configured server when the app starts so
  // tools are available immediately, without requiring a Settings visit.
  void connectAllServers()
}
