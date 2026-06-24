/**
 * MCP client manager — connects to configured MCP servers over stdio,
 * aggregates their tools into a single namespaced list, and dispatches
 * tool calls back to the right server. Called from mcp.handlers.ts (IPC)
 * and ai.handlers.ts (the tool-calling loop inside streamChat).
 */
import { randomUUID } from 'crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { store } from '../store'

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
}

export interface McpServerStatus {
  id: string
  name: string
  command: string
  args: string[]
  connected: boolean
  toolCount: number
  error?: string
}

interface AggregatedTool {
  qualifiedName: string
  description?: string
  inputSchema: Record<string, unknown>
}

interface ConnectedServer {
  client: Client
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>
}

const connected = new Map<string, ConnectedServer>()
const lastError = new Map<string, string>()
const TOOL_SEP = '__'

export function listServerConfigs(): McpServerConfig[] {
  return (store.get('mcpServers') as McpServerConfig[] | undefined) ?? []
}

function saveServerConfigs(configs: McpServerConfig[]): void {
  store.set('mcpServers', configs)
}

export function addServerConfig(config: { name: string; command: string; args: string[] }): McpServerConfig {
  const full: McpServerConfig = { ...config, id: randomUUID() }
  const configs = listServerConfigs()
  configs.push(full)
  saveServerConfigs(configs)
  return full
}

export async function removeServerConfig(id: string): Promise<void> {
  await disconnectServer(id)
  saveServerConfigs(listServerConfigs().filter((c) => c.id !== id))
}

export async function connectServer(id: string): Promise<{ success: boolean; error?: string; toolCount?: number }> {
  const config = listServerConfigs().find((c) => c.id === id)
  if (!config) return { success: false, error: 'Unknown server' }
  if (connected.has(id)) return { success: true, toolCount: connected.get(id)!.tools.length }

  try {
    const transport = new StdioClientTransport({ command: config.command, args: config.args })
    const client = new Client({ name: 'lakoora', version: '1.0.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    connected.set(id, {
      client,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
      })),
    })
    lastError.delete(id)
    return { success: true, toolCount: tools.length }
  } catch (err) {
    const message = (err as Error).message
    lastError.set(id, message)
    return { success: false, error: message }
  }
}

export async function disconnectServer(id: string): Promise<void> {
  const c = connected.get(id)
  if (c) {
    try { await c.client.close() } catch { /* already closed */ }
    connected.delete(id)
  }
}

export function listServerStatuses(): McpServerStatus[] {
  return listServerConfigs().map((c) => {
    const live = connected.get(c.id)
    return {
      id: c.id,
      name: c.name,
      command: c.command,
      args: c.args,
      connected: !!live,
      toolCount: live?.tools.length ?? 0,
      error: lastError.get(c.id),
    }
  })
}

/** Connects every configured server that isn't already connected. Used on app startup. */
export async function connectAllServers(): Promise<void> {
  await Promise.all(listServerConfigs().map((c) => connectServer(c.id)))
}

export async function disconnectAllServers(): Promise<void> {
  await Promise.all([...connected.keys()].map((id) => disconnectServer(id)))
}

/** Aggregated tools across all connected servers, namespaced as "<serverId>__<toolName>" to avoid collisions. */
export function getAggregatedTools(): AggregatedTool[] {
  const out: AggregatedTool[] = []
  for (const [serverId, server] of connected) {
    for (const tool of server.tools) {
      out.push({
        qualifiedName: `${serverId}${TOOL_SEP}${tool.name}`,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })
    }
  }
  return out
}

export async function callQualifiedTool(qualifiedName: string, args: Record<string, unknown>): Promise<string> {
  const sepIdx = qualifiedName.indexOf(TOOL_SEP)
  if (sepIdx === -1) return `Error: malformed tool name "${qualifiedName}"`
  const serverId = qualifiedName.slice(0, sepIdx)
  const toolName = qualifiedName.slice(sepIdx + TOOL_SEP.length)
  const server = connected.get(serverId)
  if (!server) return `Error: MCP server "${serverId}" is not connected`

  try {
    const result = await server.client.callTool({ name: toolName, arguments: args })
    const content = result.content as Array<{ type: string; text?: string }> | undefined
    const text = (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    return text || JSON.stringify(result)
  } catch (err) {
    return `Error calling tool "${toolName}": ${(err as Error).message}`
  }
}
