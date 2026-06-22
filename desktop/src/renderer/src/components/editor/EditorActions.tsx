import { Save, GitCompare } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { useEditorActionsStore } from '../../store/useEditorActionsStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { fg } from '../../design'

export function EditorActions() {
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const tabs = useEditorStore((s) => s.tabs)
  const markSaved = useEditorStore((s) => s.markSaved)
  const { openDiffViewer } = useEditorActionsStore()
  const projectPath = useSettingsStore((s) => s.projectPath)

  const tab = tabs.find((t) => t.id === activeTabId)
  if (!tab) return null

  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: fg[2],
    padding: '2px 6px',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
  }

  const save = async () => {
    try {
      await window.api.fs.writeFile(tab.filePath, tab.content)
      markSaved(tab.id)
      toast.success('Saved')
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px' }}>
      <button style={btnStyle} onClick={save} title="Save (⌘S)">
        <Save size={12} />
      </button>
      {projectPath && (
        <button
          style={btnStyle}
          onClick={() => openDiffViewer(tab.filePath)}
          title="View git diff"
        >
          <GitCompare size={12} />
        </button>
      )}
    </div>
  )
}
