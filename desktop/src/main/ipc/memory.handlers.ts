import { ipcMain } from 'electron'
import { runPythonJson } from '../pythonBridge'

export interface MemoryEntry {
  key: string
  content: string
  tags: string[]
  created_at: string
  updated_at: string
  source_task: string
}

export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:list', async (): Promise<MemoryEntry[]> => {
    const result = await runPythonJson(['-m', 'src.agent_memory', '--list', '--json'])
    return result.ok ? (result.stats as MemoryEntry[]) : []
  })

  ipcMain.handle('memory:query', async (_event, query: string): Promise<MemoryEntry[]> => {
    const result = await runPythonJson(['-m', 'src.agent_memory', '--query', query, '--json'])
    return result.ok ? (result.stats as MemoryEntry[]) : []
  })
}
