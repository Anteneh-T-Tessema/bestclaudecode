import { ipcMain } from 'electron'
import * as fs from 'fs'
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
  role?: string
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

  // Ideation — replaces a freshly-created plan's placeholder subtasks with
  // AI-authored ones. `--revise --json` only prints {done, total} counts
  // (verified in task_planner.py), not the revised plan, so we follow up
  // with `--show` to return the full TaskPlanDetail the caller needs.
  ipcMain.handle(
    'taskplanner:revise',
    async (_event, planFile: string, subtasks: Subtask[]): Promise<TaskPlanDetail | null> => {
      const revise = await runPythonJson(['-m', 'src.task_planner', '--revise', planFile, JSON.stringify(subtasks), '--json'])
      if (!revise.ok) return null
      const show = await runPythonJson(['-m', 'src.task_planner', '--show', planFile, '--json'])
      return show.ok ? (show.stats as TaskPlanDetail) : null
    }
  )

  // Gap 83 — delete a plan file from disk.
  ipcMain.handle('taskplanner:delete', async (_event, planPath: string): Promise<{ deleted: boolean }> => {
    try {
      fs.unlinkSync(planPath)
      return { deleted: true }
    } catch {
      return { deleted: false }
    }
  })
}
