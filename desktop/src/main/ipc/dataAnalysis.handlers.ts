import { ipcMain } from 'electron'
import { runPythonJson } from '../pythonBridge'

export interface DataAnalysisResult {
  summary: string
  chartBase64: string | null
  rowCount: number
  columnCount: number
  columns: string[]
}

export function registerDataAnalysisHandlers(): void {
  ipcMain.handle(
    'data:analyze',
    async (_event, filePath: string, query: string): Promise<DataAnalysisResult | null> => {
      const result = await runPythonJson(['-m', 'src.data_analysis', filePath, query, '--json'])
      if (!result.ok) return null
      const data = result.stats as { success: boolean } & DataAnalysisResult
      if (!data?.success) return null
      return {
        summary: data.summary,
        chartBase64: data.chartBase64 ?? null,
        rowCount: data.rowCount,
        columnCount: data.columnCount,
        columns: data.columns ?? [],
      }
    },
  )
}
