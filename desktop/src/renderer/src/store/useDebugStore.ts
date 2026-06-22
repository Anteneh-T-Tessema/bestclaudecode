import { create } from 'zustand'

export type DebugStatus = 'idle' | 'running' | 'stopped' | 'terminated'

export interface StackFrame {
  id: number
  name: string
  source?: { path?: string; name?: string }
  line: number
  column: number
}

export interface Variable {
  name: string
  value: string
  type?: string
  variablesReference: number
}

export interface DebugOutput {
  text: string
  category?: string
}

// Per-file breakpoint lines. Key is the absolute file path.
export type BreakpointMap = Record<string, number[]>

interface DebugStore {
  status: DebugStatus
  activeThreadId: number
  activeFrameId: number | null
  stackFrames: StackFrame[]
  variables: Variable[]
  output: DebugOutput[]
  breakpoints: BreakpointMap
  watchExpressions: string[]
  watchResults: Record<string, string>

  setStatus: (s: DebugStatus) => void
  setStopped: (threadId: number, frames: StackFrame[], vars: Variable[]) => void
  setActiveFrame: (frameId: number, vars: Variable[]) => void
  setOutput: (entries: DebugOutput[]) => void
  appendOutput: (entry: DebugOutput) => void
  toggleBreakpoint: (filePath: string, line: number) => void
  setBreakpoints: (filePath: string, lines: number[]) => void
  addWatch: (expression: string) => void
  removeWatch: (expression: string) => void
  setWatchResult: (expression: string, result: string) => void
  reset: () => void
}

export const useDebugStore = create<DebugStore>((set, get) => ({
  status: 'idle',
  activeThreadId: 1,
  activeFrameId: null,
  stackFrames: [],
  variables: [],
  output: [],
  breakpoints: {},
  watchExpressions: [],
  watchResults: {},

  setStatus: (status) => set({ status }),

  setStopped: (activeThreadId, stackFrames, variables) =>
    set({ status: 'stopped', activeThreadId, stackFrames, variables, activeFrameId: stackFrames[0]?.id ?? null }),

  setActiveFrame: (activeFrameId, variables) => set({ activeFrameId, variables }),

  setOutput: (output) => set({ output }),

  appendOutput: (entry) => set((s) => ({ output: [...s.output.slice(-499), entry] })),

  toggleBreakpoint: (filePath, line) => {
    const existing = get().breakpoints[filePath] ?? []
    const next = existing.includes(line)
      ? existing.filter((l) => l !== line)
      : [...existing, line].sort((a, b) => a - b)
    set((s) => ({ breakpoints: { ...s.breakpoints, [filePath]: next } }))
  },

  setBreakpoints: (filePath, lines) =>
    set((s) => ({ breakpoints: { ...s.breakpoints, [filePath]: lines } })),

  addWatch: (expression) => {
    if (!get().watchExpressions.includes(expression)) {
      set((s) => ({ watchExpressions: [...s.watchExpressions, expression] }))
    }
  },

  removeWatch: (expression) =>
    set((s) => ({
      watchExpressions: s.watchExpressions.filter((e) => e !== expression),
      watchResults: Object.fromEntries(
        Object.entries(s.watchResults).filter(([k]) => k !== expression)
      ),
    })),

  setWatchResult: (expression, result) =>
    set((s) => ({ watchResults: { ...s.watchResults, [expression]: result } })),

  reset: () => set({
    status: 'idle', stackFrames: [], variables: [], activeFrameId: null,
    output: [], watchResults: {},
  }),
}))
