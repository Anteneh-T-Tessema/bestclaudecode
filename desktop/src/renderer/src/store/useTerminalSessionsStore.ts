import { create } from 'zustand'

export interface TerminalSession {
  id: string
  label: string
}

interface TerminalSessionsStore {
  sessions: TerminalSession[]
  activeId: string | null
  addSession: () => void
  closeSession: (id: string) => void
  setActiveId: (id: string) => void
}

let nextN = 1

export const useTerminalSessionsStore = create<TerminalSessionsStore>((set, get) => ({
  sessions: [{ id: 'term-1', label: 'Terminal 1' }],
  activeId: 'term-1',

  addSession: () => {
    nextN += 1
    const session = { id: `term-${Date.now()}-${nextN}`, label: `Terminal ${nextN}` }
    set((s) => ({ sessions: [...s.sessions, session], activeId: session.id }))
  },

  closeSession: (id) => {
    const { sessions, activeId } = get()
    const remaining = sessions.filter((s) => s.id !== id)
    const nextActive = activeId === id ? (remaining[remaining.length - 1]?.id ?? null) : activeId
    set({ sessions: remaining, activeId: nextActive })
  },

  setActiveId: (id) => set({ activeId: id }),
}))
