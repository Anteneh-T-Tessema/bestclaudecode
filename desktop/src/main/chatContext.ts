/**
 * Shared client for src.chat_context — runs hybrid (BM25 + embedding) repo
 * search and returns enriched hits. Used by autonomousAgent.ts (per-subtask
 * repo orientation) and mcpManager.ts (the builtin search_codebase tool),
 * which each format the results differently for their own prompt shape.
 */
import { runPythonJson } from './pythonBridge'

export interface RelatedDecision {
  filename: string
  task: string
  verdict: string
  outcome: string
}

export interface ChatContextResult {
  file: string
  line: string
  snippet: string
  score: number
  related_decisions: RelatedDecision[]
}

interface ChatContextResponse {
  query: string
  results: ChatContextResult[]
}

/** Never throws — callers treat an empty array as "no context available". */
export async function runChatContext(query: string, root: string): Promise<ChatContextResult[]> {
  try {
    const result = await runPythonJson(['-m', 'src.chat_context', query, root, '--json'])
    if (!result.ok) return []
    const { results } = result.stats as ChatContextResponse
    return results ?? []
  } catch {
    return []
  }
}
