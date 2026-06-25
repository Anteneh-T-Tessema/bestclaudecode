import { create } from 'zustand'

export type ActivityId = 'files' | 'git' | 'chat' | 'search' | 'memory' | 'codesearch' | 'tasks' | 'audit' | 'archdoc' | 'agent' | 'debug' | 'outline' | 'notepads' | 'usage' | 'map' | 'github' | 'settings'
export type ActiveView = 'welcome' | 'editor'
export type BottomPanelTab = 'terminal' | 'problems'

interface AppStore {
  activeActivity: ActivityId
  activeView: ActiveView
  commandPaletteOpen: boolean
  quickOpenOpen: boolean
  shortcutsOpen: boolean
  sidebarOpen: boolean
  bottomPanelOpen: boolean
  bottomPanelTab: BottomPanelTab
  terminalOutput: string
  setActiveActivity: (id: ActivityId) => void
  setActiveView: (view: ActiveView) => void
  toggleActivity: (id: ActivityId) => void
  setCommandPaletteOpen: (open: boolean) => void
  setQuickOpenOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleBottomPanel: () => void
  setBottomPanelOpen: (open: boolean) => void
  setBottomPanelTab: (tab: BottomPanelTab) => void
  openProblems: () => void
  zenMode: boolean
  toggleZenMode: () => void
  setZenMode: (on: boolean) => void
  appendTerminalOutput: (chunk: string) => void
}

const TERMINAL_CAP = 5000

export const useAppStore = create<AppStore>((set, get) => ({
  activeActivity: 'audit',
  activeView: 'welcome',
  commandPaletteOpen: false,
  quickOpenOpen: false,
  shortcutsOpen: false,
  sidebarOpen: true,
  bottomPanelOpen: true,
  bottomPanelTab: 'terminal',
  terminalOutput: '',
  setActiveActivity: (id) => set({ activeActivity: id }),
  setActiveView: (view) => set({ activeView: view }),
  toggleActivity: (id) => {
    const current = get().activeActivity
    set({ activeActivity: current === id ? current : id })
  },
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setQuickOpenOpen: (open) => set({ quickOpenOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
  openProblems: () => set({ bottomPanelOpen: true, bottomPanelTab: 'problems' }),
  zenMode: false,
  toggleZenMode: () => set((s) => ({ zenMode: !s.zenMode })),
  setZenMode: (on) => set({ zenMode: on }),
  appendTerminalOutput: (chunk) => set((s) => {
    const combined = s.terminalOutput + chunk
    return { terminalOutput: combined.length > TERMINAL_CAP ? combined.slice(-TERMINAL_CAP) : combined }
  }),
}))
