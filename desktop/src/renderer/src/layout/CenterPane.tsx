import { useAppStore } from '../store/useAppStore'
import { useEditorStore } from '../store/useEditorStore'
import { useEditorActionsStore } from '../store/useEditorActionsStore'
import { WelcomeScreen } from '../components/WelcomeScreen'
import { EditorTabs } from '../components/editor/EditorTabs'
import { MonacoEditor } from '../components/editor/MonacoEditor'
import { InlineAIEdit } from '../components/editor/InlineAIEdit'
import { GoToLine } from '../components/editor/GoToLine'
import { DiffViewer } from '../components/editor/DiffViewer'
import { surface } from '../design'

export function CenterPane() {
  const activeView = useAppStore((s) => s.activeView)
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const { inlineEditOpen, goToLineOpen, diffViewerOpen, diffViewerPath } = useEditorActionsStore()

  const hasOpenTabs = tabs.length > 0

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
      {activeView === 'welcome' && !hasOpenTabs ? (
        <WelcomeScreen />
      ) : (
        <>
          <EditorTabs />
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {activeTabId && <MonacoEditor tabId={activeTabId} />}
            {inlineEditOpen && <InlineAIEdit />}
            {goToLineOpen && <GoToLine />}
            {diffViewerOpen && diffViewerPath && <DiffViewer filePath={diffViewerPath} />}
          </div>
        </>
      )}
    </div>
  )
}
