/**
 * Shared client for src.agent_memory — queries persisted agent memory
 * entries (decisions/preferences recorded via auto_record_from_decision).
 * Used by memory.handlers.ts (renderer IPC) and autonomousAgent.ts
 * (per-subtask "relevant past learnings" block).
 */
import { runPythonJson } from './pythonBridge'

export interface MemoryEntry {
  key: string
  content: string
  tags: string[]
  created_at: string
  updated_at: string
  source_task: string
}

/** Never throws — callers treat an empty array as "no relevant memories". */
export async function queryAgentMemory(query: string): Promise<MemoryEntry[]> {
  try {
    const result = await runPythonJson(['-m', 'src.agent_memory', '--query', query, '--json'])
    if (!result.ok) return []
    return (result.stats as MemoryEntry[]) ?? []
  } catch {
    return []
  }
}
