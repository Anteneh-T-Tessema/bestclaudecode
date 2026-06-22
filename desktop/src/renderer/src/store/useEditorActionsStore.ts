import { create } from 'zustand'

interface EditorActionsStore {
  inlineEditOpen: boolean
  inlineEditTarget: { tabId: string; startLine: number; endLine: number; selectedText: string } | null
  goToLineOpen: boolean
  diffViewerOpen: boolean
  diffViewerPath: string | null

  openInlineEdit: (tabId: string, startLine: number, endLine: number, selectedText: string) => void
  closeInlineEdit: () => void
  openGoToLine: () => void
  closeGoToLine: () => void
  openDiffViewer: (filePath: string) => void
  closeDiffViewer: () => void
}

export const useEditorActionsStore = create<EditorActionsStore>((set) => ({
  inlineEditOpen: false,
  inlineEditTarget: null,
  goToLineOpen: false,
  diffViewerOpen: false,
  diffViewerPath: null,

  openInlineEdit: (tabId, startLine, endLine, selectedText) =>
    set({ inlineEditOpen: true, inlineEditTarget: { tabId, startLine, endLine, selectedText } }),
  closeInlineEdit: () => set({ inlineEditOpen: false, inlineEditTarget: null }),

  openGoToLine: () => set({ goToLineOpen: true }),
  closeGoToLine: () => set({ goToLineOpen: false }),

  openDiffViewer: (filePath) => set({ diffViewerOpen: true, diffViewerPath: filePath }),
  closeDiffViewer: () => set({ diffViewerOpen: false, diffViewerPath: null }),
}))
