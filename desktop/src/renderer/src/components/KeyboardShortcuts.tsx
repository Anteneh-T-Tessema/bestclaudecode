import { useEffect, useRef } from 'react'
import { X, Keyboard } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { accent, border, fg, surface } from '../design'

const SECTIONS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['⌘', 'Shift', 'P'], label: 'Command Palette' },
      { keys: ['⌘', 'P'], label: 'Go to File' },
      { keys: ['⌘', 'T'], label: 'Go to Symbol in Workspace' },
      { keys: ['⌘', 'B'], label: 'Toggle Sidebar' },
      { keys: ['⌘', '`'], label: 'Toggle Terminal' },
      { keys: ['⌘', '/'], label: 'Keyboard Shortcuts' },
      { keys: ['⌘K', 'Z'], label: 'Zen Mode' },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: ['⌘', 'S'], label: 'Save File' },
      { keys: ['⌘', 'K'], label: 'Inline AI Edit (selection)' },
      { keys: ['⌘', 'G'], label: 'Go to Line' },
      { keys: ['⇧', '⌥', 'F'], label: 'Format Document' },
      { keys: ['⌘', 'F'], label: 'Find in File' },
      { keys: ['⌘', '+'], label: 'Increase Font Size' },
      { keys: ['⌘', '–'], label: 'Decrease Font Size' },
      { keys: ['⌘', '0'], label: 'Reset Font Size' },
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
  const setSymbolSearchOpen = useAppStore((s) => s.setSymbolSearchOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleBottomPanel = useAppStore((s) => s.toggleBottomPanel)
  const toggleZenMode = useAppStore((s) => s.toggleZenMode)
  const setZenMode = useAppStore((s) => s.setZenMode)
  const saveFontSize = useSettingsStore((s) => s.set)

  // Chord state: ⌘K arms the chord; a subsequent Z within 1 s fires Zen Mode.
  const chordPending = useRef(false)
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Second key of ⌘K Z chord
      if (chordPending.current && !meta && e.key === 'z') {
        e.preventDefault()
        chordPending.current = false
        if (chordTimer.current) clearTimeout(chordTimer.current)
        toggleZenMode()
        return
      }
      // Any other key cancels the pending chord
      if (chordPending.current && e.key !== 'k') {
        chordPending.current = false
        if (chordTimer.current) clearTimeout(chordTimer.current)
      }

      if (!meta) {
        // Escape exits zen mode
        if (e.key === 'Escape' && useAppStore.getState().zenMode) {
          setZenMode(false)
        }
        return
      }

      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        const cur = useSettingsStore.getState().fontSize
        void saveFontSize('fontSize', Math.min(28, cur + 1))
      } else if (e.key === '-') {
        e.preventDefault()
        const cur = useSettingsStore.getState().fontSize
        void saveFontSize('fontSize', Math.max(10, cur - 1))
      } else if (e.key === '0') {
        e.preventDefault()
        void saveFontSize('fontSize', 14)
      } else if (e.key === 'p' && e.shiftKey) {
        e.preventDefault()
        setCommandPaletteOpen(true)
      } else if (e.key === 'p') {
        e.preventDefault()
        setQuickOpenOpen(true)
      } else if (e.key === 't') {
        e.preventDefault()
        setSymbolSearchOpen(true)
      } else if (e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === '`') {
        e.preventDefault()
        toggleBottomPanel()
      } else if (e.key === '/') {
        e.preventDefault()
        setOpen(!useAppStore.getState().shortcutsOpen)
      } else if (e.key === 'k') {
        // Arm chord — next Z triggers zen mode
        e.preventDefault()
        chordPending.current = true
        if (chordTimer.current) clearTimeout(chordTimer.current)
        chordTimer.current = setTimeout(() => { chordPending.current = false }, 1000)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setCommandPaletteOpen, setQuickOpenOpen, setSymbolSearchOpen, toggleSidebar, toggleBottomPanel, setOpen, toggleZenMode, setZenMode, saveFontSize])

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
            title="Close"
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
