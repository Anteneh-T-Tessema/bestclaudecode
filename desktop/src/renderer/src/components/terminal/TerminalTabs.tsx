import { Plus, X } from 'lucide-react'
import { Terminal } from './Terminal'
import { useTerminalSessionsStore } from '../../store/useTerminalSessionsStore'
import { border, fg, surface, accent } from '../../design'

// Gap 96 — multiple terminal tabs. Every session's <Terminal/> stays mounted
// (just hidden via CSS) so switching tabs doesn't kill its PTY, scrollback,
// or in-flight AI-overlay state — only the active one is visible at a time.
export function TerminalTabs() {
  const sessions = useTerminalSessionsStore((s) => s.sessions)
  const activeId = useTerminalSessionsStore((s) => s.activeId)
  const addSession = useTerminalSessionsStore((s) => s.addSession)
  const closeSession = useTerminalSessionsStore((s) => s.closeSession)
  const setActiveId = useTerminalSessionsStore((s) => s.setActiveId)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {sessions.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 26,
            flexShrink: 0,
            borderBottom: `1px solid ${border[2]}`,
            background: surface.surface,
            overflowX: 'auto',
          }}
        >
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setActiveId(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: '100%',
                padding: '0 8px 0 10px',
                fontSize: 10.5,
                color: activeId === s.id ? fg[0] : fg[3],
                background: activeId === s.id ? surface.raised : 'transparent',
                borderRight: `1px solid ${border[2]}`,
                cursor: 'pointer',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              {s.label}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closeSession(s.id) }}
                title="Close terminal"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 14, height: 14, borderRadius: 3, border: 'none',
                  background: 'none', color: fg[4], cursor: 'pointer', padding: 0,
                }}
              >
                <X size={9} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addSession}
            title="New terminal"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: '100%', border: 'none', flexShrink: 0,
              background: 'none', color: accent.green.fg, cursor: 'pointer',
            }}
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {sessions.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 11, color: fg[4] }}>
            No terminal sessions —{' '}
            <button
              type="button"
              onClick={addSession}
              style={{ background: 'none', border: 'none', color: accent.green.fg, cursor: 'pointer', fontSize: 11, marginLeft: 4, padding: 0 }}
            >
              open one
            </button>
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              style={{
                position: 'absolute', inset: 0,
                display: activeId === s.id ? 'block' : 'none',
              }}
            >
              <Terminal />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
