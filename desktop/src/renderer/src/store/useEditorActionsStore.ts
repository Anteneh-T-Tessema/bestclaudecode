import { create } from 'zustand'

interface EditorActionsStore {
  inlineEditOpen: boolean
  inlineEditTarget: { tabId: string; startLine: number; endLine: number; selectedText: string } | null
  goToLineOpen: boolean
  diffViewerOpen: boolean
  diffViewerPath: string | null
  mdPreviewOpen: boolean

  openInlineEdit: (tabId: string, startLine: number, endLine: number, selectedText: string) => void
  closeInlineEdit: () => void
  openGoToLine: () => void
  closeGoToLine: () => void
  openDiffViewer: (filePath: string) => void
  closeDiffViewer: () => void
  toggleMdPreview: () => void
  setMdPreviewOpen: (v: boolean) => void
}

export const useEditorActionsStore = create<EditorActionsStore>((set) => ({
  inlineEditOpen: false,
  inlineEditTarget: null,
  goToLineOpen: false,
  diffViewerOpen: false,
  diffViewerPath: null,
  mdPreviewOpen: false,

  openInlineEdit: (tabId, startLine, endLine, selectedText) =>
    set({ inlineEditOpen: true, inlineEditTarget: { tabId, startLine, endLine, selectedText } }),
  closeInlineEdit: () => set({ inlineEditOpen: false, inlineEditTarget: null }),

  openGoToLine: () => set({ goToLineOpen: true }),
  closeGoToLine: () => set({ goToLineOpen: false }),

  openDiffViewer: (filePath) => set({ diffViewerOpen: true, diffViewerPath: filePath }),
  closeDiffViewer: () => set({ diffViewerOpen: false, diffViewerPath: null }),

  toggleMdPreview: () => set((s) => ({ mdPreviewOpen: !s.mdPreviewOpen })),
  setMdPreviewOpen: (v) => set({ mdPreviewOpen: v }),
}))
