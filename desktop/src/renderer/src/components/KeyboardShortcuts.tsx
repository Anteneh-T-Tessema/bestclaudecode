import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { accent, border, fg, surface } from '../design'

const SECTIONS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['⌘', 'Shift', 'P'], label: 'Command Palette' },
      { keys: ['⌘', 'P'], label: 'Go to File' },
      { keys: ['⌘', 'B'], label: 'Toggle Sidebar' },
      { keys: ['⌘', '`'], label: 'Toggle Terminal' },
      { keys: ['⌘', '/'], label: 'Keyboard Shortcuts' },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: ['⌘', 'S'], label: 'Save File' },
      { keys: ['⌘', 'K'], label: 'Inline AI Edit (selection)' },
      { keys: ['⌘', 'G'], label: 'Go to Line' },
      { keys: ['⌘', 'F'], label: 'Find in File' },
    ],
  },
  {
    title: 'AI Chat',
    shortcuts: [
      { keys: ['Enter'], label: 'Send message' },
      { keys: ['Shift', 'Enter'], label: 'New line in message' },
    ],
  },
  {
    title: 'Source Control',
    shortcuts: [{ keys: ['⌘', 'Enter'], label: 'Commit (in commit box)' }],
  },
]

function Key({ k }: { k: string }) {
  const wide = k.length > 2
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontFamily: 'inherit',
        padding: wide ? '2px 6px' : '2px 5px',
        minWidth: 18,
        height: 18,
        background: surface.overlay,
        border: `1px solid ${border[0]}`,
        borderRadius: 3,
        color: fg[2],
        boxShadow: `0 1px 0 ${border[0]}`,
      }}
    >
      {k}
    </kbd>
  )
}

export function KeyboardShortcuts() {
  const open = useAppStore((s) => s.shortcutsOpen)
  const setOpen = useAppStore((s) => s.setShortcutsOpen)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setQuickOpenOpen = useAppStore((s) => s.setQuickOpenOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleBottomPanel = useAppStore((s) => s.toggleBottomPanel)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return

      if (e.key === 'p' && e.shiftKey) {
        e.preventDefault()
        setCommandPaletteOpen(true)
      } else if (e.key === 'p') {
        e.preventDefault()
        setQuickOpenOpen(true)
      } else if (e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === '`') {
        e.preventDefault()
        toggleBottomPanel()
      } else if (e.key === '/') {
        e.preventDefault()
        setOpen(!useAppStore.getState().shortcutsOpen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setCommandPaletteOpen, setQuickOpenOpen, toggleSidebar, toggleBottomPanel, setOpen])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9995,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '80vh',
          background: surface.raised,
          border: `1px solid ${border[0]}`,
          borderRadius: 10,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: `1px solid ${border[1]}`,
          }}
        >
          <Keyboard size={14} color={accent.amber.fg} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: fg[0] }}>Keyboard Shortcuts</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3] }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: accent.amber.fg,
                  marginBottom: 8,
                }}
              >
                {section.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {section.shortcuts.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      borderRadius: 4,
                      background: surface.raised,
                    }}
                  >
                    <span style={{ fontSize: 11, color: fg[2] }}>{s.label}</span>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
                      {s.keys.map((k, j) => (
                        <span key={j} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          {j > 0 && <span style={{ fontSize: 9, color: fg[4] }}>+</span>}
                          <Key k={k} />
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: '8px 16px',
            borderTop: `1px solid ${border[1]}`,
            fontSize: 10,
            color: fg[4],
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>⌘ = Cmd on Mac, Ctrl on Windows/Linux</span>
          <span>Press Esc or click outside to close</span>
        </div>
      </div>
    </div>
  )
}
