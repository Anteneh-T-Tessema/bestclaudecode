import { useEditorStore } from '../store/useEditorStore'
import { useChatStore, MODELS } from '../store/useChatStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useProblemsStore } from '../store/useProblemsStore'
import { useAppStore } from '../store/useAppStore'
import { surface, fg, accent, border } from '../design'
import { GitBranch, AlertCircle, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'

export function StatusBar() {
  const activeTab = useEditorStore((s) => s.getActiveTab())
  const activeModel = useChatStore((s) => s.activeModel)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const problems = useProblemsStore((s) => s.problems)
  const openProblems = useAppStore((s) => s.openProblems)
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath) return
    window.api.git.branch(projectPath).then(setBranch).catch(() => setBranch(null))
  }, [projectPath])

  const modelLabel = MODELS.find((m) => m.id === activeModel)?.label ?? activeModel
  const errorCount = problems.filter((p) => p.severity === 'error').length
  const warnCount = problems.filter((p) => p.severity === 'warning').length

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
        {(errorCount > 0 || warnCount > 0) && (
          <button
            type="button"
            onClick={openProblems}
            title="Open Problems panel"
            style={{
              ...itemStyle,
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              borderRight: `1px solid ${border[2]}`,
              padding: '0 8px',
              gap: 6,
            }}
          >
            {errorCount > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: accent.red.fg }}>
                <AlertCircle size={11} />
                <span style={{ fontSize: 11 }}>{errorCount}</span>
              </span>
            )}
            {warnCount > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: accent.amber.fg }}>
                <AlertTriangle size={11} />
                <span style={{ fontSize: 11 }}>{warnCount}</span>
              </span>
            )}
          </button>
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
