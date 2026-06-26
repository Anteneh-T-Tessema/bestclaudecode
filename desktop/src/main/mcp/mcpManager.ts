/**
 * MCP client manager — connects to configured MCP servers over stdio,
 * aggregates their tools (plus one builtin `search_codebase` tool backed by
 * the repo's own hybrid retrieval) into a single namespaced list, and
 * dispatches tool calls back to the right server. Called from
 * mcp.handlers.ts (IPC) and ai.handlers.ts (the tool-calling loop inside
 * streamChat).
 */
import { randomUUID } from 'crypto'
import * as path from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { store } from '../store'
import { repoRoot } from '../paths'
import { runChatContext } from '../chatContext'
import { runPythonJson } from '../pythonBridge'

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
const BUILTIN_SERVER_ID = '_meshflow'

export function listServerConfigs(): McpServerConfig[] {
  const saved = store.get('mcpServers') as McpServerConfig[] | undefined
  if (saved && saved.length > 0) return saved
  
  const defaults: McpServerConfig[] = [
    {
      id: 'build-log-server',
      name: 'build-log-server',
      command: 'node',
      args: [path.join(repoRoot(), 'mcp-servers/build-log-server/dist/index.js')],
    },
    {
      id: 'local-devops-server',
      name: 'local-devops-server',
      command: 'node',
      args: [path.join(repoRoot(), 'mcp-servers/local-devops-server/dist/index.js')],
    },
    {
      id: 'playwright-browser-server',
      name: 'playwright-browser-server',
      command: 'node',
      args: [path.join(repoRoot(), 'mcp-servers/playwright-browser-server/dist/index.js')],
    },
  ]
  store.set('mcpServers', defaults)
  return defaults
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
    const client = new Client({ name: 'meshflow', version: '1.0.0' })
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
    {
      qualifiedName: `${BUILTIN_SERVER_ID}${TOOL_SEP}find_callers`,
      description:
        'Find every call site of a function or method by name in this repo — the agent-callable equivalent of "Find references". Use this to check who depends on a function before changing its signature or behavior.',
      inputSchema: {
        type: 'object',
        properties: {
          function_name: { type: 'string', description: 'The exact function or method name to search for (no parentheses)' },
        },
        required: ['function_name'],
      },
    },
    {
      qualifiedName: `${BUILTIN_SERVER_ID}${TOOL_SEP}get_dependencies`,
      description:
        'List a file\'s direct imports ("depends_on") or the files that import it ("dependents_of") — the agent-callable equivalent of "Go to definition"/"Find references" at the file level. Works for both Python and TypeScript/JavaScript files in this repo.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Path to the file, relative to the repo root or absolute' },
          direction: {
            type: 'string',
            enum: ['depends_on', 'dependents_of'],
            description: 'depends_on (default): files this file imports. dependents_of: files that import this file.',
          },
        },
        required: ['file'],
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
    .map((r) => {
      let block = `${r.file}:${r.line} — ${r.score}\n${r.snippet}`
      const decisionNotes = r.related_decisions.map((d) => `Related decision: "${d.task}" → ${d.verdict}`)
      if (decisionNotes.length) block = `${block}\n${decisionNotes.join('\n')}`
      if (r.callers.length) {
        const sites = r.callers.map((c) => `${c.file}:${c.line}`).join(', ')
        block = `${block}\nCalled from ${r.callers.length} other places: ${sites}`
      }
      return block
    })
    .join('\n\n---\n\n')
}

async function callBuiltinFindCallers(args: Record<string, unknown>): Promise<string> {
  const functionName = args.function_name as string | undefined
  if (!functionName) return '(no results: missing "function_name" argument)'

  const result = await runPythonJson(['-m', 'src.repo_map', '--callers', functionName, repoRoot(), '--json'])
  if (!result.ok) return `(error: ${result.error ?? 'unknown'})`
  const { results } = result.stats as { results: Array<{ file: string; line: number }> }
  if (!results.length) return `(no call sites found for "${functionName}")`
  return results.map((r) => `${r.file}:${r.line}`).join('\n')
}

async function callBuiltinGetDependencies(args: Record<string, unknown>): Promise<string> {
  const file = args.file as string | undefined
  if (!file) return '(no results: missing "file" argument)'
  const direction = (args.direction as string | undefined) === 'dependents_of' ? 'dependents_of' : 'depends_on'
  const flag = direction === 'dependents_of' ? '--dependents-of' : '--depends-on'

  const result = await runPythonJson(['-m', 'src.repo_map', flag, file, repoRoot(), '--json'])
  if (!result.ok) return `(error: ${result.error ?? 'unknown'})`
  const { results } = result.stats as { results: string[] }
  if (!results.length) return `(no ${direction === 'dependents_of' ? 'dependents' : 'dependencies'} found for "${file}")`
  return results.join('\n')
}

export async function callQualifiedTool(qualifiedName: string, args: Record<string, unknown>): Promise<string> {
  const sepIdx = qualifiedName.indexOf(TOOL_SEP)
  if (sepIdx === -1) return `Error: malformed tool name "${qualifiedName}"`
  const serverId = qualifiedName.slice(0, sepIdx)
  const toolName = qualifiedName.slice(sepIdx + TOOL_SEP.length)

  if (serverId === BUILTIN_SERVER_ID) {
    try {
      if (toolName === 'find_callers') return await callBuiltinFindCallers(args)
      if (toolName === 'get_dependencies') return await callBuiltinGetDependencies(args)
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
