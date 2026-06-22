import { useState } from 'react'
import { X } from 'lucide-react'
import { surface, border, fg, accent } from '../design'
import { Terminal } from '../components/terminal/Terminal'
import { ProblemsPanel } from '../components/ProblemsPanel'

type BottomTab = 'terminal' | 'problems'

interface BottomPanelProps {
  onClose: () => void
}

export function BottomPanel({ onClose }: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<BottomTab>('terminal')

  const tabStyle = (id: BottomTab): React.CSSProperties => ({
    padding: '0 14px',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    color: activeTab === id ? fg[0] : fg[2],
    background: 'none',
    border: 'none',
    borderBottom: activeTab === id ? `2px solid ${accent.blue.fg}` : '2px solid transparent',
    userSelect: 'none',
  })

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: surface.raised,
        overflow: 'hidden',
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          height: 35,
          display: 'flex',
          alignItems: 'center',
          borderBottom: `1px solid ${border[1]}`,
          background: surface.surface,
          flexShrink: 0,
          paddingLeft: 4,
        }}
      >
        <button style={tabStyle('terminal')} onClick={() => setActiveTab('terminal')}>
          TERMINAL
        </button>
        <button style={tabStyle('problems')} onClick={() => setActiveTab('problems')}>
          PROBLEMS
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          aria-label="Close panel"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: fg[3],
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            height: '100%',
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'terminal' ? <Terminal /> : <ProblemsPanel />}
      </div>
    </div>
  )
}
