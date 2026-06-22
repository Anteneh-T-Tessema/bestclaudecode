import { create } from 'zustand'

export type ProblemSeverity = 'error' | 'warning' | 'info' | 'hint'

export interface Problem {
  id: string
  filePath: string
  line: number
  col: number
  endLine?: number
  endCol?: number
  message: string
  severity: ProblemSeverity
  source?: string
}

interface ProblemsStore {
  problems: Problem[]
  setProblems: (filePath: string, problems: Problem[]) => void
  clearProblems: (filePath: string) => void
  clearAll: () => void
}

export const useProblemsStore = create<ProblemsStore>((set) => ({
  problems: [],

  setProblems: (filePath, newProblems) => {
    set((s) => ({
      problems: [
        ...s.problems.filter((p) => p.filePath !== filePath),
        ...newProblems,
      ],
    }))
  },

  clearProblems: (filePath) => {
    set((s) => ({ problems: s.problems.filter((p) => p.filePath !== filePath) }))
  },

  clearAll: () => set({ problems: [] }),
}))
