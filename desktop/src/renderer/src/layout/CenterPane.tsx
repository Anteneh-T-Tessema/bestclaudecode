import { useAppStore } from '../store/useAppStore'
import { useEditorStore } from '../store/useEditorStore'
import { useEditorActionsStore } from '../store/useEditorActionsStore'
import { WelcomeScreen } from '../components/WelcomeScreen'
import { EditorTabs } from '../components/editor/EditorTabs'
import { MonacoEditor } from '../components/editor/MonacoEditor'
import { ImagePreview } from '../components/editor/ImagePreview'
import { MarkdownPreview } from '../components/editor/MarkdownPreview'
import { InlineAIEdit } from '../components/editor/InlineAIEdit'
import { GoToLine } from '../components/editor/GoToLine'
import { DiffViewer } from '../components/editor/DiffViewer'
import { Breadcrumb } from '../components/editor/Breadcrumb'
import { surface, fg, border } from '../design'
import { isImageFile, isMarkdownFile } from '../utils/fileType'

export function CenterPane() {
  const activeView = useAppStore((s) => s.activeView)
  const zenMode = useAppStore((s) => s.zenMode)
  const setZenMode = useAppStore((s) => s.setZenMode)
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const hasOpenTabs = tabs.length > 0
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeFilePath = activeTab?.filePath ?? ''
  const { inlineEditOpen, goToLineOpen, diffViewerOpen, diffViewerPath, mdPreviewOpen } =
    useEditorActionsStore()

  type EditorMode = 'image' | 'md-split' | 'editor'
  const editorMode: EditorMode =
    isImageFile(activeFilePath) ? 'image'
    : isMarkdownFile(activeFilePath) && mdPreviewOpen ? 'md-split'
    : 'editor'

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: surface.base,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {zenMode && (
        <button
          type="button"
          onClick={() => setZenMode(false)}
          title="Exit Zen Mode"
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            zIndex: 100,
            background: surface.overlay,
            border: `1px solid ${border[1]}`,
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 10,
            color: fg[3],
            cursor: 'pointer',
            letterSpacing: '0.04em',
          }}
        >
          Zen · Esc to exit
        </button>
      )}

      {activeView === 'welcome' && !hasOpenTabs ? (
        <WelcomeScreen />
      ) : (
        <>
          <EditorTabs />
          <Breadcrumb />
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {activeTabId && editorMode === 'image' && (
              <ImagePreview filePath={activeFilePath} />
            )}
            {activeTabId && editorMode === 'editor' && <MonacoEditor tabId={activeTabId} />}
            {activeTabId && editorMode === 'md-split' && (
              <div style={{ display: 'flex', height: '100%' }}>
                <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                  <MonacoEditor tabId={activeTabId} />
                </div>
                <div style={{ width: 1, background: border[1], flexShrink: 0 }} />
                <div style={{ width: 480, flexShrink: 0, overflow: 'hidden' }}>
                  <MarkdownPreview content={activeTab?.content ?? ''} />
                </div>
              </div>
            )}
            {inlineEditOpen && editorMode === 'editor' && <InlineAIEdit />}
            {goToLineOpen && <GoToLine />}
            {diffViewerOpen && diffViewerPath && <DiffViewer filePath={diffViewerPath} />}
          </div>
        </>
      )}
    </div>
  )
}
