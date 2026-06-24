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
}
