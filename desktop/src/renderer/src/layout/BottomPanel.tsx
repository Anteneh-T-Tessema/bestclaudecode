import { X } from 'lucide-react'
import { surface, border, fg, accent } from '../design'
import { Terminal } from '../components/terminal/Terminal'
import { ProblemsPanel } from '../components/ProblemsPanel'
import { useAppStore } from '../store/useAppStore'
import { useProblemsStore } from '../store/useProblemsStore'

interface BottomPanelProps {
  onClose: () => void
}

export function BottomPanel({ onClose }: BottomPanelProps) {
  const activeTab = useAppStore((s) => s.bottomPanelTab)
  const setActiveTab = useAppStore((s) => s.setBottomPanelTab)
  const problems = useProblemsStore((s) => s.problems)

  const errorCount = problems.filter((p) => p.severity === 'error').length
  const warnCount = problems.filter((p) => p.severity === 'warning').length

  const tabStyle = (id: typeof activeTab): React.CSSProperties => ({
    padding: '0 14px',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
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
        <button type="button" style={tabStyle('terminal')} onClick={() => setActiveTab('terminal')}>
          TERMINAL
        </button>
        <button type="button" style={tabStyle('problems')} onClick={() => setActiveTab('problems')}>
          PROBLEMS
          {(errorCount > 0 || warnCount > 0) && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginLeft: 4,
                fontSize: 10,
              }}
            >
              {errorCount > 0 && (
                <span style={{ color: accent.red.fg, fontWeight: 700 }}>{errorCount}</span>
              )}
              {warnCount > 0 && (
                <span style={{ color: accent.amber.fg, fontWeight: 700 }}>{warnCount}</span>
              )}
            </span>
          )}
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

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'terminal' ? <Terminal /> : <ProblemsPanel />}
      </div>
    </div>
  )
}
