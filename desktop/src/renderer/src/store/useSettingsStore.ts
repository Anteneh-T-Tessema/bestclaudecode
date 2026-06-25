import { create } from 'zustand'
import type { ModelId } from './useChatStore'

export type Theme = 'dark' | 'light'

interface SettingsStore {
  anthropicApiKey: string
  openaiApiKey: string
  googleApiKey: string
  ollamaUrl: string
  theme: Theme
  fontSize: number
  wordWrap: boolean
  minimap: boolean
  tabSize: 2 | 4
  autoSave: boolean
  formatOnSave: boolean
  inlayHints: boolean
  stickyScroll: boolean
  /** Gap 139 — last-used Live Preview URL per project, keyed by projectPath. */
  livePreviewUrlsByProject: Record<string, string>
  recentFiles: string[]
  projectPath: string
  recentProjects: string[]
  activeModel: ModelId
  globalRules: string
  loaded: boolean

  // Actions
  load: () => Promise<void>
  set: <K extends keyof Omit<SettingsStore, 'loaded' | 'load' | 'set' | 'save'>>(
    key: K,
    value: SettingsStore[K]
  ) => Promise<void>
  save: (patch: Partial<Omit<SettingsStore, 'loaded' | 'load' | 'set' | 'save'>>) => Promise<void>
}

const DEFAULTS = {
  anthropicApiKey: '',
  openaiApiKey: '',
  googleApiKey: '',
  ollamaUrl: 'http://localhost:11434',
  theme: 'dark' as Theme,
  fontSize: 14,
  wordWrap: false,
  minimap: true,
  tabSize: 2 as 2 | 4,
  autoSave: true,
  formatOnSave: false,
  inlayHints: false,
  stickyScroll: true,
  livePreviewUrlsByProject: {} as Record<string, string>,
  recentFiles: [] as string[],
  projectPath: '',
  recentProjects: [] as string[],
  activeModel: 'claude-sonnet-4-6' as ModelId,
  globalRules: '',
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULTS,
  loaded: false,

  load: async () => {
    try {
      const all = await window.api.settings.getAll()
      const patch: Partial<typeof DEFAULTS> = {}
      if (all && typeof all === 'object') {
        for (const k of Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>) {
          const val = (all as Record<string, unknown>)[k]
          if (val !== undefined && val !== null) {
            ;(patch as Record<string, unknown>)[k] = val
          }
        }
      }
      set({ ...DEFAULTS, ...patch, loaded: true })
      // Sync persisted model into chat store so all AI calls use the right model immediately.
      const model = (patch.activeModel ?? DEFAULTS.activeModel) as ModelId
      const { useChatStore } = await import('./useChatStore')
      useChatStore.getState().setActiveModel(model)
    } catch {
      set({ loaded: true })
    }
  },

  set: async (key, value) => {
    set({ [key]: value } as Partial<SettingsStore>)
    try {
      await window.api.settings.set(key as string, value)
    } catch {
      // Ignore persistence errors
    }
  },

  save: async (patch) => {
    set(patch as Partial<SettingsStore>)
    try {
      for (const [k, v] of Object.entries(patch)) {
        await window.api.settings.set(k, v)
      }
    } catch {
      // Ignore persistence errors
    }
  },
}))
