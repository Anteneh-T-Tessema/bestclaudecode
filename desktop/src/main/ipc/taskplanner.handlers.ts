import { ipcMain } from 'electron'
import { runPythonJson } from '../pythonBridge'

export interface PlanSummary {
  slug: string
  goal: string
  done: number
  total: number
  path: string
}

export interface Subtask {
  id: string
  description: string
  depends_on: string[]
  done: boolean
}

export interface TaskPlanDetail {
  goal: string
  slug: string
  subtasks: Subtask[]
}

export function registerTaskPlannerHandlers(): void {
  ipcMain.handle('taskplanner:list', async (): Promise<PlanSummary[]> => {
    const result = await runPythonJson(['-m', 'src.task_planner', '--list', '--json'])
    return result.ok ? (result.stats as PlanSummary[]) : []
  })

  ipcMain.handle('taskplanner:show', async (_event, path: string): Promise<TaskPlanDetail | null> => {
    const result = await runPythonJson(['-m', 'src.task_planner', '--show', path, '--json'])
    return result.ok ? (result.stats as TaskPlanDetail) : null
  })

  ipcMain.handle(
    'taskplanner:markDone',
    async (_event, path: string, subtaskId: string): Promise<{ id: string; done: number; total: number } | null> => {
      const result = await runPythonJson(['-m', 'src.task_planner', '--done', path, subtaskId, '--json'])
      return result.ok ? (result.stats as { id: string; done: number; total: number }) : null
    }
  )

  ipcMain.handle('taskplanner:new', async (_event, goal: string): Promise<TaskPlanDetail | null> => {
    const result = await runPythonJson(['-m', 'src.task_planner', '--new', goal, '--save'])
    return result.ok ? (result.stats as TaskPlanDetail) : null
  })
}
