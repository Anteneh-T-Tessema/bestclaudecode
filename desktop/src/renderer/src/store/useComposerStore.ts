import { create } from 'zustand'

export interface ComposerContextItem {
  type: 'file' | 'symbol' | 'selection' | 'diff'
  value: string
}

interface ComposerStore {
  isOpen: boolean
  contextItems: ComposerContextItem[]
  open: () => void
  close: () => void
  addContext: (item: ComposerContextItem) => void
  removeContext: (index: number) => void
  clearContext: () => void
}

export const useComposerStore = create<ComposerStore>((set) => ({
  isOpen: false,
  contextItems: [],
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  addContext: (item) => set((s) => ({ contextItems: [...s.contextItems, item] })),
  removeContext: (index) => set((s) => ({ contextItems: s.contextItems.filter((_, i) => i !== index) })),
  clearContext: () => set({ contextItems: [] }),
}))
