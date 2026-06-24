import { ipcMain } from 'electron'
import { runPythonJson } from '../pythonBridge'
import { queryAgentMemory, type MemoryEntry } from '../agentMemory'

export type { MemoryEntry }

export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:list', async (): Promise<MemoryEntry[]> => {
    const result = await runPythonJson(['-m', 'src.agent_memory', '--list', '--json'])
    return result.ok ? (result.stats as MemoryEntry[]) : []
  })

  ipcMain.handle('memory:query', async (_event, query: string): Promise<MemoryEntry[]> => {
    return queryAgentMemory(query)
  })

  // Gap 80 — write a memory entry from the IDE.
  ipcMain.handle('memory:write', async (_event, key: string, content: string): Promise<boolean> => {
    const result = await runPythonJson(['-m', 'src.agent_memory', '--write', key, content, '--json'])
    return result.ok
  })

  // Gap 80 — delete a memory entry from the IDE.
  ipcMain.handle('memory:delete', async (_event, key: string): Promise<boolean> => {
    const result = await runPythonJson(['-m', 'src.agent_memory', '--delete', key, '--json'])
    if (!result.ok) return false
    return (result.stats as { deleted: boolean }).deleted ?? false
  })
}
