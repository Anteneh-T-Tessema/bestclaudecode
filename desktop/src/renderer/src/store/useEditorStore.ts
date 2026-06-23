import { create } from 'zustand'
import { useAppStore } from './useAppStore'
import { useSettingsStore } from './useSettingsStore'

export interface EditorTab {
  id: string
  filePath: string
  label: string
  content: string
  language: string
  isDirty: boolean
  cursorLine?: number
  cursorCol?: number
}

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    json: 'json',
    jsonc: 'json',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    mdx: 'markdown',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'ini',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    rb: 'ruby',
    php: 'php',
    c: 'c',
    cpp: 'cpp',
    h: 'cpp',
    cs: 'csharp',
    sql: 'sql',
    xml: 'xml',
    svg: 'xml',
    dockerfile: 'dockerfile',
    graphql: 'graphql',
    gql: 'graphql',
    prisma: 'prisma',
  }
  return map[ext] ?? 'plaintext'
}

interface EditorStore {
  tabs: EditorTab[]
  activeTabId: string | null
  editorSelection: string
  openFile: (filePath: string, content: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateContent: (id: string, content: string) => void
  markSaved: (id: string) => void
  setCursor: (id: string, line: number, col: number) => void
  setEditorSelection: (text: string) => void
  getActiveTab: () => EditorTab | null
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  editorSelection: '',

  openFile: (filePath, content) => {
    // Keep a persisted MRU list of recently opened files (max 20, deduped).
    void useSettingsStore.getState().save({
      recentFiles: [
        filePath,
        ...useSettingsStore.getState().recentFiles.filter((p) => p !== filePath),
      ].slice(0, 20),
    })

    const existing = get().tabs.find((t) => t.filePath === filePath)
    if (existing) {
      set({ activeTabId: existing.id })
      useAppStore.getState().setActiveView('editor')
      return
    }
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const label = filePath.split('/').pop() ?? filePath
    const tab: EditorTab = {
      id,
      filePath,
      label,
      content,
      language: getLanguage(filePath),
      isDirty: false,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    useAppStore.getState().setActiveView('editor')
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    const remaining = tabs.filter((t) => t.id !== id)
    let nextActive: string | null = activeTabId
    if (activeTabId === id) {
      if (remaining.length === 0) {
        nextActive = null
        useAppStore.getState().setActiveView('welcome')
      } else {
        const newIdx = Math.min(idx, remaining.length - 1)
        nextActive = remaining[newIdx]?.id ?? null
      }
    }
    set({ tabs: remaining, activeTabId: nextActive })
  },

  setActiveTab: (id) => {
    set({ activeTabId: id })
    useAppStore.getState().setActiveView('editor')
  },

  updateContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, isDirty: true } : t)),
    }))
  },

  markSaved: (id) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: false } : t)),
    }))
  },

  setCursor: (id, line, col) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, cursorLine: line, cursorCol: col } : t)),
    }))
  },

  setEditorSelection: (text) => set({ editorSelection: text }),

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) ?? null
  },
}))
