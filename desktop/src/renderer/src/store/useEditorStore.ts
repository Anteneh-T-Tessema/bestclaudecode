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
  splitOpen: boolean
  splitTabId: string | null
  openFile: (filePath: string, content: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateContent: (id: string, content: string) => void
  markSaved: (id: string) => void
  setCursor: (id: string, line: number, col: number) => void
  setEditorSelection: (text: string) => void
  getActiveTab: () => EditorTab | null
  openSplit: (tabId: string) => void
  closeSplit: () => void
  setSplitTabId: (id: string) => void
  // Gap 115 — session persistence: restore open tabs on relaunch
  saveSession: () => Promise<void>
  restoreSession: () => Promise<void>
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  editorSelection: '',
  splitOpen: false,
  splitTabId: null,

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

  openSplit: (tabId) => set({ splitOpen: true, splitTabId: tabId }),
  closeSplit: () => set({ splitOpen: false, splitTabId: null }),
  setSplitTabId: (id) => set({ splitTabId: id }),

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) ?? null
  },

  saveSession: async () => {
    const { tabs, activeTabId } = get()
    const activeTab = tabs.find((t) => t.id === activeTabId)
    const sessionTabs = tabs.map((t) => ({
      filePath: t.filePath,
      cursorLine: t.cursorLine,
      cursorCol: t.cursorCol,
    }))
    try {
      await window.api.settings.set('sessionTabs', sessionTabs)
      await window.api.settings.set('sessionActiveFile', activeTab?.filePath ?? '')
    } catch { /* ignore */ }
  },

  restoreSession: async () => {
    try {
      const raw = await window.api.settings.get('sessionTabs')
      const activeFile = (await window.api.settings.get('sessionActiveFile')) as string | undefined
      if (!Array.isArray(raw) || raw.length === 0) return
      const entries = raw as Array<{ filePath: string; cursorLine?: number; cursorCol?: number }>
      for (const entry of entries) {
        try {
          const content = await window.api.fs.readFile(entry.filePath)
          get().openFile(entry.filePath, content)
          if ((entry.cursorLine ?? 0) > 0) {
            const { tabs } = get()
            const tab = tabs.find((t) => t.filePath === entry.filePath)
            if (tab) get().setCursor(tab.id, entry.cursorLine!, entry.cursorCol ?? 1)
          }
        } catch { /* file may have been deleted */ }
      }
      if (activeFile) {
        const { tabs } = get()
        const active = tabs.find((t) => t.filePath === activeFile)
        if (active) get().setActiveTab(active.id)
      }
    } catch { /* ignore */ }
  },
}))
