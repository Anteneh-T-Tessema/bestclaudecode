import { ipcMain } from 'electron'
import { runPythonJson } from '../pythonBridge'

interface FunctionEntry { name: string; lineno: number; summary: string }
interface ClassEntry { name: string; lineno: number; summary: string; methods: FunctionEntry[] }

export interface ArchModule {
  path: string
  module_name: string
  summary: string
  functions: FunctionEntry[]
  classes: ClassEntry[]
  imports: string[]
}

export interface ArchDocResult {
  modules: ArchModule[]
  markdown: string
}

export function registerArchDocHandlers(): void {
  ipcMain.handle('archDoc:generate', async (): Promise<ArchDocResult | null> => {
    const result = await runPythonJson(['-m', 'src.arch_doc', '--json'])
    return result.ok ? (result.stats as ArchDocResult) : null
  })
}
