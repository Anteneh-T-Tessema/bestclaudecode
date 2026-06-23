import { useAppStore } from '../store/useAppStore'
import { useEditorStore } from '../store/useEditorStore'
import { useEditorActionsStore } from '../store/useEditorActionsStore'
import { WelcomeScreen } from '../components/WelcomeScreen'
import { EditorTabs } from '../components/editor/EditorTabs'
import { MonacoEditor } from '../components/editor/MonacoEditor'
import { ImagePreview } from '../components/editor/ImagePreview'
import { InlineAIEdit } from '../components/editor/InlineAIEdit'
import { GoToLine } from '../components/editor/GoToLine'
import { DiffViewer } from '../components/editor/DiffViewer'
import { Breadcrumb } from '../components/editor/Breadcrumb'
import { surface, fg, border } from '../design'
import { isImageFile } from '../utils/fileType'

export function CenterPane() {
  const activeView = useAppStore((s) => s.activeView)
  const zenMode = useAppStore((s) => s.zenMode)
  const setZenMode = useAppStore((s) => s.setZenMode)
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const { inlineEditOpen, goToLineOpen, diffViewerOpen, diffViewerPath } = useEditorActionsStore()

  const hasOpenTabs = tabs.length > 0
  const activeFilePath = tabs.find((t) => t.id === activeTabId)?.filePath ?? ''

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
            {activeTabId && isImageFile(activeFilePath) && (
              <ImagePreview filePath={activeFilePath} />
            )}
            {activeTabId && !isImageFile(activeFilePath) && <MonacoEditor tabId={activeTabId} />}
            {inlineEditOpen && !isImageFile(activeFilePath) && <InlineAIEdit />}
            {goToLineOpen && <GoToLine />}
            {diffViewerOpen && diffViewerPath && <DiffViewer filePath={diffViewerPath} />}
          </div>
        </>
      )}
    </div>
  )
}
