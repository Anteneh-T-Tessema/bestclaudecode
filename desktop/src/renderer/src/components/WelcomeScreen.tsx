import { useAppStore } from '../store/useAppStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { fg, accent, surface, border } from '../design'
import { Files, GitBranch, MessageSquare, Keyboard } from 'lucide-react'

const SHORTCUTS = [
  { keys: '⌘P', label: 'Quick Open file' },
  { keys: '⌘⇧P', label: 'Command Palette' },
  { keys: '⌘K', label: 'Inline AI Edit (selection)' },
  { keys: '⌘`', label: 'Toggle terminal' },
  { keys: '⌘G', label: 'Go to line' },
]

export function WelcomeScreen() {
  const setActivity = useAppStore((s) => s.setActiveActivity)
  const setQuickOpen = useAppStore((s) => s.setQuickOpenOpen)
  const projectPath = useSettingsStore((s) => s.projectPath)

  const cardStyle: React.CSSProperties = {
    background: surface.raised,
    border: `1px solid ${border[0]}`,
    borderRadius: 8,
    padding: '16px 20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    transition: 'border-color 0.15s',
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        overflow: 'auto',
      }}
    >
      {/* Logo + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <svg width="32" height="32" viewBox="0 0 16 16" fill="none">
          <path d="M8 0 L15 3 V8 C15 12 12 15 8 16 C4 15 1 12 1 8 V3 Z" fill={accent.green.fg} opacity="0.9" />
        </svg>
        <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', color: fg[0] }}>
          LAKOORA
        </span>
      </div>
      <p style={{ color: fg[2], fontSize: 13, marginBottom: 40, textAlign: 'center' }}>
        AI-powered coding environment
      </p>

      {/* Project path */}
      {projectPath && (
        <div
          style={{
            background: surface.surface,
            border: `1px solid ${border[1]}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            color: fg[2],
            marginBottom: 32,
            fontFamily: 'monospace',
            maxWidth: 480,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {projectPath}
        </div>
      )}

      {/* Action cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          width: '100%',
          maxWidth: 560,
          marginBottom: 40,
        }}
      >
        <div style={cardStyle} onClick={() => setQuickOpen(true)}>
          <Files size={18} style={{ color: accent.blue.fg, flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: fg[0] }}>Open File</div>
            <div style={{ fontSize: 11, color: fg[2], marginTop: 2 }}>⌘P to quick-open any file</div>
          </div>
        </div>

        <div style={cardStyle} onClick={() => setActivity('git')}>
          <GitBranch size={18} style={{ color: accent.amber.fg, flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: fg[0] }}>Source Control</div>
            <div style={{ fontSize: 11, color: fg[2], marginTop: 2 }}>Stage and commit changes</div>
          </div>
        </div>

        <div style={cardStyle} onClick={() => setActivity('chat')}>
          <MessageSquare size={18} style={{ color: accent.violet.fg, flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: fg[0] }}>AI Chat</div>
            <div style={{ fontSize: 11, color: fg[2], marginTop: 2 }}>Ask Claude, GPT-4o, Gemini</div>
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div
        style={{
          background: surface.surface,
          border: `1px solid ${border[1]}`,
          borderRadius: 8,
          padding: '16px 24px',
          width: '100%',
          maxWidth: 400,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Keyboard size={14} style={{ color: fg[2] }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: fg[1], letterSpacing: '0.06em' }}>
            KEYBOARD SHORTCUTS
          </span>
        </div>
        {SHORTCUTS.map((s) => (
          <div
            key={s.keys}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}
          >
            <span style={{ fontSize: 12, color: fg[2] }}>{s.label}</span>
            <kbd
              style={{
                background: surface.raised,
                border: `1px solid ${border[0]}`,
                borderRadius: 4,
                padding: '1px 6px',
                fontSize: 11,
                color: fg[1],
                fontFamily: 'monospace',
              }}
            >
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}
