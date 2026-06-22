import { useEditorStore } from '../store/useEditorStore'
import { useChatStore, MODELS } from '../store/useChatStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { surface, fg, accent, border } from '../design'
import { GitBranch } from 'lucide-react'
import { useState, useEffect } from 'react'

export function StatusBar() {
  const activeTab = useEditorStore((s) => s.getActiveTab())
  const activeModel = useChatStore((s) => s.activeModel)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath) return
    window.api.git.branch(projectPath).then(setBranch).catch(() => setBranch(null))
  }, [projectPath])

  const modelLabel = MODELS.find((m) => m.id === activeModel)?.label ?? activeModel

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '0 10px',
    height: '100%',
    fontSize: 11,
    color: fg[1],
    cursor: 'default',
    userSelect: 'none',
    borderRight: `1px solid ${border[2]}`,
  }

  return (
    <div
      style={{
        height: 22,
        background: surface.void,
        borderTop: `1px solid ${border[2]}`,
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Left side */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        {branch && (
          <div style={itemStyle}>
            <GitBranch size={12} style={{ color: accent.green.fg }} />
            <span>{branch}</span>
          </div>
        )}
        {activeTab && (
          <div style={itemStyle}>
            <span style={{ color: fg[2] }}>{activeTab.language}</span>
            {activeTab.cursorLine !== undefined && (
              <span style={{ color: fg[3] }}>
                Ln {activeTab.cursorLine}, Col {activeTab.cursorCol ?? 1}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <div style={{ ...itemStyle, borderRight: 'none', borderLeft: `1px solid ${border[2]}`, color: accent.violet.fg }}>
          {modelLabel}
        </div>
      </div>
    </div>
  )
}
