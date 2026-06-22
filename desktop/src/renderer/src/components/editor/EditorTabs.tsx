import { X } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { surface, border, fg, accent } from '../../design'

export function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const closeTab = useEditorStore((s) => s.closeTab)

  if (tabs.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        background: surface.void,
        borderBottom: `1px solid ${border[1]}`,
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: '100%',
              padding: '0 12px 0 14px',
              gap: 8,
              cursor: 'pointer',
              background: isActive ? surface.base : 'transparent',
              borderRight: `1px solid ${border[1]}`,
              borderBottom: isActive ? `2px solid ${accent.blue.fg}` : '2px solid transparent',
              color: isActive ? fg[0] : fg[2],
              fontSize: 12,
              fontWeight: isActive ? 500 : 400,
              flexShrink: 0,
              maxWidth: 200,
              userSelect: 'none',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
              title={tab.filePath}
            >
              {tab.isDirty && (
                <span style={{ color: accent.amber.fg, marginRight: 4 }}>●</span>
              )}
              {tab.label}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              aria-label={`Close ${tab.label}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                color: fg[3],
                display: 'flex',
                alignItems: 'center',
                borderRadius: 3,
                flexShrink: 0,
              }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
