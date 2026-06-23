import { create } from 'zustand'

export interface Notepad {
  id: string
  title: string
  content: string
  updatedAt: number
}

interface NotepadStore {
  notepads: Notepad[]
  activeId: string | null
  loadedForProject: string | null
  loadForProject: (projectPath: string) => void
  createNotepad: () => void
  deleteNotepad: (id: string) => void
  updateContent: (id: string, content: string) => void
  renameNotepad: (id: string, title: string) => void
  setActiveId: (id: string | null) => void
}

function storageKey(projectPath: string): string {
  return `lakoora:notepads:${projectPath}`
}

function persist(projectPath: string, notepads: Notepad[]): void {
  try {
    localStorage.setItem(storageKey(projectPath), JSON.stringify(notepads))
  } catch {}
}

function load(projectPath: string): Notepad[] {
  try {
    const raw = localStorage.getItem(storageKey(projectPath))
    if (raw) return JSON.parse(raw) as Notepad[]
  } catch {}
  return []
}

function newNotepad(): Notepad {
  return {
    id: `np_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'Untitled',
    content: '',
    updatedAt: Date.now(),
  }
}

export const useNotepadStore = create<NotepadStore>((set, get) => ({
  notepads: [],
  activeId: null,
  loadedForProject: null,

  loadForProject: (projectPath) => {
    if (get().loadedForProject === projectPath) return
    const notepads = load(projectPath)
    set({
      notepads,
      activeId: notepads[0]?.id ?? null,
      loadedForProject: projectPath,
    })
  },

  createNotepad: () => {
    const np = newNotepad()
    const { notepads, loadedForProject } = get()
    const next = [np, ...notepads]
    set({ notepads: next, activeId: np.id })
    if (loadedForProject) persist(loadedForProject, next)
  },

  deleteNotepad: (id) => {
    const { notepads, activeId, loadedForProject } = get()
    const next = notepads.filter((n) => n.id !== id)
    const newActive = activeId === id ? (next[0]?.id ?? null) : activeId
    set({ notepads: next, activeId: newActive })
    if (loadedForProject) persist(loadedForProject, next)
  },

  updateContent: (id, content) => {
    const { notepads, loadedForProject } = get()
    const next = notepads.map((n) =>
      n.id === id ? { ...n, content, updatedAt: Date.now() } : n
    )
    set({ notepads: next })
    if (loadedForProject) persist(loadedForProject, next)
  },

  renameNotepad: (id, title) => {
    const { notepads, loadedForProject } = get()
    const next = notepads.map((n) =>
      n.id === id ? { ...n, title, updatedAt: Date.now() } : n
    )
    set({ notepads: next })
    if (loadedForProject) persist(loadedForProject, next)
  },

  setActiveId: (id) => set({ activeId: id }),
}))
