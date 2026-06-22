import { create } from 'zustand'

export type ActivityId = 'files' | 'git' | 'chat' | 'search' | 'memory' | 'codesearch' | 'tasks' | 'audit' | 'archdoc' | 'agent' | 'debug' | 'settings'
export type ActiveView = 'welcome' | 'editor'

interface AppStore {
  activeActivity: ActivityId
  activeView: ActiveView
  commandPaletteOpen: boolean
  quickOpenOpen: boolean
  shortcutsOpen: boolean
  sidebarOpen: boolean
  bottomPanelOpen: boolean
  setActiveActivity: (id: ActivityId) => void
  setActiveView: (view: ActiveView) => void
  toggleActivity: (id: ActivityId) => void
  setCommandPaletteOpen: (open: boolean) => void
  setQuickOpenOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleBottomPanel: () => void
  setBottomPanelOpen: (open: boolean) => void
}

export const useAppStore = create<AppStore>((set, get) => ({
  activeActivity: 'audit',
  activeView: 'welcome',
  commandPaletteOpen: false,
  quickOpenOpen: false,
  shortcutsOpen: false,
  sidebarOpen: true,
  bottomPanelOpen: true,
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
}))
