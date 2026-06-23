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
import { surface, fg, border, accent } from '../design'
import { isImageFile, isMarkdownFile } from '../utils/fileType'
import { X } from 'lucide-react'

export function CenterPane() {
  const activeView = useAppStore((s) => s.activeView)
  const zenMode = useAppStore((s) => s.zenMode)
  const setZenMode = useAppStore((s) => s.setZenMode)
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const splitOpen = useEditorStore((s) => s.splitOpen)
  const splitTabId = useEditorStore((s) => s.splitTabId)
  const closeSplit = useEditorStore((s) => s.closeSplit)
  const setSplitTabId = useEditorStore((s) => s.setSplitTabId)
  const hasOpenTabs = tabs.length > 0
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const splitTab = tabs.find((t) => t.id === splitTabId)
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
          {/* Main editor area — split when splitOpen */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex' }}>
            {/* Left pane */}
            <div style={{ flex: 1, overflow: 'hidden', minWidth: 0, position: 'relative' }}>
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

            {/* Right split pane */}
            {splitOpen && splitTabId && (
              <>
                <div style={{ width: 1, background: border[1], flexShrink: 0 }} />
                <div style={{
                  flex: 1,
                  overflow: 'hidden',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}>
                  {/* Split pane header — tab strip */}
                  <div style={{
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    background: surface.void,
                    borderBottom: `1px solid ${border[1]}`,
                    flexShrink: 0,
                    overflowX: 'auto',
                    overflowY: 'hidden',
                  }}>
                    {tabs.map((tab) => {
                      const isActive = tab.id === splitTabId
                      return (
                        <div
                          key={tab.id}
                          onClick={() => setSplitTabId(tab.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            height: '100%',
                            padding: '0 12px 0 14px',
                            gap: 6,
                            cursor: 'pointer',
                            background: isActive ? surface.base : 'transparent',
                            borderRight: `1px solid ${border[1]}`,
                            borderBottom: isActive ? `2px solid ${accent.cyan.fg}` : '2px solid transparent',
                            color: isActive ? fg[0] : fg[2],
                            fontSize: 12,
                            fontWeight: isActive ? 500 : 400,
                            flexShrink: 0,
                            maxWidth: 180,
                            userSelect: 'none',
                          }}
                        >
                          <span style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}>
                            {tab.isDirty && <span style={{ color: accent.amber.fg, marginRight: 4 }}>●</span>}
                            {tab.label}
                          </span>
                        </div>
                      )
                    })}
                    {/* Close split button */}
                    <button
                      type="button"
                      onClick={closeSplit}
                      title="Close split"
                      style={{
                        marginLeft: 'auto',
                        marginRight: 6,
                        flexShrink: 0,
                        background: 'none',
                        border: 'none',
                        color: fg[3],
                        cursor: 'pointer',
                        padding: '3px 5px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: 3,
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {/* Split pane editor */}
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    {splitTab && isImageFile(splitTab.filePath) ? (
                      <ImagePreview filePath={splitTab.filePath} />
                    ) : (
                      <MonacoEditor tabId={splitTabId} />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
