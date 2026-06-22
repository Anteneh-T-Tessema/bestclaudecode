import { useState, useEffect } from 'react'
import { useEditorActionsStore } from '../../store/useEditorActionsStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { surface, border, fg, accent } from '../../design'
import { X } from 'lucide-react'

interface DiffViewerProps {
  filePath: string
}

export function DiffViewer({ filePath }: DiffViewerProps) {
  const { closeDiffViewer } = useEditorActionsStore()
  const projectPath = useSettingsStore((s) => s.projectPath)
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectPath) return
    setLoading(true)
    window.api.git
      .diff(projectPath, filePath)
      .then((d) => { setDiff(d); setLoading(false) })
      .catch(() => { setDiff(''); setLoading(false) })
  }, [projectPath, filePath])

  const renderDiff = () => {
    if (loading) return <div style={{ padding: 16, color: fg[2], fontSize: 12 }}>Loading diff…</div>
    if (!diff) return <div style={{ padding: 16, color: fg[2], fontSize: 12 }}>No changes</div>

    return diff.split('\n').map((line, i) => {
      let color: string = fg[1]
      let bg: string = 'transparent'
      if (line.startsWith('+') && !line.startsWith('+++')) { color = accent.green.fg; bg = accent.green.subtle }
      else if (line.startsWith('-') && !line.startsWith('---')) { color = accent.red.fg; bg = accent.red.subtle }
      else if (line.startsWith('@')) { color = accent.cyan.fg }
      return (
        <div key={i} style={{ background: bg, color, fontFamily: 'monospace', fontSize: 11, padding: '1px 12px', whiteSpace: 'pre' }}>
          {line}
        </div>
      )
    })
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: surface.base,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderBottom: `1px solid ${border[1]}`,
          background: surface.surface,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: fg[0] }}>Git Diff</span>
        <span style={{ fontSize: 11, color: fg[3], flex: 1 }}>{filePath}</span>
        <button
          onClick={closeDiffViewer}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], padding: 2 }}
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderDiff()}
      </div>
    </div>
  )
}
