/**
 * MCP client manager — connects to configured MCP servers over stdio,
 * aggregates their tools (plus one builtin `search_codebase` tool backed by
 * the repo's own hybrid retrieval) into a single namespaced list, and
 * dispatches tool calls back to the right server. Called from
 * mcp.handlers.ts (IPC) and ai.handlers.ts (the tool-calling loop inside
 * streamChat).
 */
import { randomUUID } from 'crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { store } from '../store'
import { repoRoot } from '../paths'
import { runChatContext } from '../chatContext'

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
// Not a real connected server — just the namespace prefix for the builtin
// tool below. Must not contain TOOL_SEP itself, or qualified-name splitting
// (which splits on the first occurrence) would misparse it.
const BUILTIN_SERVER_ID = '_lakoora'

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

/** Aggregated tools across all connected servers, namespaced as "<serverId>__<toolName>" to avoid collisions, plus one builtin tool. */
export function getAggregatedTools(): AggregatedTool[] {
  const out: AggregatedTool[] = [
    {
      qualifiedName: `${BUILTIN_SERVER_ID}${TOOL_SEP}search_codebase`,
      description:
        'Search this repo with hybrid (BM25 + embedding rerank) retrieval. Use this when the automatic context already injected into the conversation isn\'t sufficient and you need to look up more code.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords, identifiers, or a natural-language description of what to find' },
        },
        required: ['query'],
      },
    },
  ]
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

async function callBuiltinSearchCodebase(args: Record<string, unknown>): Promise<string> {
  const query = args.query as string | undefined
  if (!query) return '(no results: missing "query" argument)'

  const results = await runChatContext(query, repoRoot())
  if (!results.length) return `(no results for: "${query}")`

  return results
    .map((r) => `${r.file}:${r.line} — ${r.score}\n${r.snippet}`)
    .join('\n\n---\n\n')
}

export async function callQualifiedTool(qualifiedName: string, args: Record<string, unknown>): Promise<string> {
  const sepIdx = qualifiedName.indexOf(TOOL_SEP)
  if (sepIdx === -1) return `Error: malformed tool name "${qualifiedName}"`
  const serverId = qualifiedName.slice(0, sepIdx)
  const toolName = qualifiedName.slice(sepIdx + TOOL_SEP.length)

  if (serverId === BUILTIN_SERVER_ID) {
    try {
      return await callBuiltinSearchCodebase(args)
    } catch (err) {
      return `(no results: ${(err as Error).message})`
    }
  }

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
