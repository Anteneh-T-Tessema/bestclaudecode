import { useEffect, useRef, useCallback, useState } from 'react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useAppStore } from '../../store/useAppStore'
import { useChatStore } from '../../store/useChatStore'
import { surface, border, fg, accent } from '../../design'

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const termIdRef = useRef<string | null>(null)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const fontSize = useSettingsStore((s) => s.fontSize)

  // Gap 18 — ⌘K AI command overlay
  const [aiOpen, setAiOpen] = useState(false)
  const [aiQuery, setAiQuery] = useState('')
  const [aiResult, setAiResult] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const aiInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (aiOpen) setTimeout(() => aiInputRef.current?.focus(), 50)
  }, [aiOpen])

  const closeAI = useCallback(() => {
    setAiOpen(false)
    setAiQuery('')
    setAiResult('')
    setAiStreaming(false)
    termRef.current?.focus()
  }, [])

  const generateCommand = useCallback(async (query: string) => {
    if (!query.trim()) return
    setAiStreaming(true)
    setAiResult('')
    const { activeModel } = useChatStore.getState()
    try {
      const streamId = await window.api.ai.streamChat({
        messages: [{ role: 'user', content: query.trim() }],
        model: activeModel,
        systemPrompt:
          'You are a shell command expert. Generate a single shell command that accomplishes what the user describes. Output ONLY the raw command — no explanation, no markdown, no code fences, no backticks. Just the command itself.',
      })
      await new Promise<void>((resolve, reject) => {
        const unChunk = window.api.ai.onChunk(streamId, (delta) => {
          setAiResult((r) => r + delta)
        })
        const unDone = window.api.ai.onDone(streamId, () => {
          unChunk(); unDone(); unError(); resolve()
        })
        const unError = window.api.ai.onError(streamId, (err) => {
          unChunk(); unDone(); unError(); reject(new Error(err))
        })
      })
    } catch {
      setAiResult('# error — try again')
    } finally {
      setAiStreaming(false)
    }
  }, [])

  const runCommand = useCallback((cmd: string) => {
    const trimmed = cmd.trim()
    if (!trimmed || !termIdRef.current) return
    window.api.terminal.write(termIdRef.current, trimmed + '\r')
    closeAI()
  }, [closeAI])

  const initTerminal = useCallback(async () => {
    if (!containerRef.current) return

    const { Terminal: XTerm } = await import('@xterm/xterm')
    const { FitAddon } = await import('@xterm/addon-fit')
    const { WebLinksAddon } = await import('@xterm/addon-web-links')

    const term = new XTerm({
      fontSize: fontSize - 1,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
      theme: {
        background: '#1a1d27',
        foreground: '#e2e8f0',
        cursor: '#63b3ed',
        cursorAccent: '#1a202c',
        selectionBackground: 'rgba(99,179,237,0.3)',
        black: '#1a202c',
        red: '#fc8181',
        green: '#68d391',
        yellow: '#f6ad55',
        blue: '#63b3ed',
        magenta: '#b794f4',
        cyan: '#76e4f7',
        white: '#e2e8f0',
        brightBlack: '#4a5568',
        brightRed: '#feb2b2',
        brightGreen: '#9ae6b4',
        brightYellow: '#fbd38d',
        brightBlue: '#90cdf4',
        brightMagenta: '#d6bcfa',
        brightCyan: '#b2f5ea',
        brightWhite: '#f7fafc',
      },
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())

    termRef.current = term
    fitRef.current = fit

    term.open(containerRef.current)
    fit.fit()

    // ⌘K (mac) / Ctrl+K (linux/win) → open AI overlay
    term.attachCustomKeyEventHandler((e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && e.type === 'keydown') {
        setAiOpen(true)
        return false
      }
      return true
    })

    // Create PTY session
    const result = await window.api.terminal.create({
      cwd: projectPath || undefined,
      cols: term.cols,
      rows: term.rows,
    })

    let termId: string | null = null
    if (typeof result === 'string') {
      termId = result
    } else if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') {
      termId = result.id
    }

    if (!termId) {
      term.write('\r\n\x1b[31mFailed to create terminal session\x1b[0m\r\n')
      return
    }

    termIdRef.current = termId

    // Data from PTY → xterm + terminal output capture
    const unData = window.api.terminal.onData(termId, (data) => {
      term.write(data)
      useAppStore.getState().appendTerminalOutput(data)
    })

    const unExit = window.api.terminal.onExit(termId, (_code) => {
      term.write('\r\n\x1b[33mProcess exited\x1b[0m\r\n')
    })

    // User input → PTY
    term.onData((data) => {
      if (termIdRef.current) {
        window.api.terminal.write(termIdRef.current, data)
      }
    })

    // Resize
    term.onResize(({ cols, rows }) => {
      if (termIdRef.current) {
        window.api.terminal.resize(termIdRef.current, cols, rows)
      }
    })

    // Store cleanup fns
    ;(termRef.current as unknown as { _lakooraCleanup?: () => void })._lakooraCleanup = () => {
      unData()
      unExit()
    }
  }, [projectPath, fontSize])

  useEffect(() => {
    initTerminal()

    return () => {
      const term = termRef.current
      if (term) {
        const cleanup = (term as unknown as { _lakooraCleanup?: () => void })._lakooraCleanup
        if (cleanup) cleanup()
        term.dispose()
        termRef.current = null
      }
      if (termIdRef.current) {
        window.api.terminal.kill(termIdRef.current)
        termIdRef.current = null
      }
    }
  }, [initTerminal])

  // Fit on container resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      fitRef.current?.fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* ⌘K AI command overlay */}
      {aiOpen && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            background: surface.overlay,
            borderBottom: `1px solid ${border[0]}`,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10,
              color: accent.violet.fg,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>
              Terminal AI
            </span>
            <span style={{ fontSize: 10, color: fg[3], marginLeft: 'auto' }}>
              Esc to dismiss
            </span>
          </div>

          <input
            ref={aiInputRef}
            type="text"
            value={aiQuery}
            placeholder="Describe what you want to do…"
            onChange={(e) => setAiQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); closeAI(); return }
              if (e.key === 'Enter') {
                e.preventDefault()
                if (aiResult && !aiStreaming) {
                  runCommand(aiResult)
                } else {
                  generateCommand(aiQuery)
                }
              }
            }}
            style={{
              background: surface.raised,
              border: `1px solid ${border[0]}`,
              borderRadius: 6,
              color: fg[0],
              fontSize: 13,
              padding: '7px 10px',
              outline: 'none',
              fontFamily: 'inherit',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />

          {(aiResult || aiStreaming) && (
            <div style={{
              background: surface.void,
              border: `1px solid ${border[1]}`,
              borderRadius: 6,
              padding: '7px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <pre style={{
                flex: 1,
                margin: 0,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 12,
                color: accent.green.fg,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                lineHeight: 1.5,
              }}>
                {aiResult || ' '}
              </pre>
              {aiStreaming && (
                <span style={{ fontSize: 10, color: fg[3], flexShrink: 0 }}>generating…</span>
              )}
              {!aiStreaming && aiResult && (
                <button
                  type="button"
                  onClick={() => runCommand(aiResult)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = accent.violet.subtle
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  }}
                  style={{
                    flexShrink: 0,
                    padding: '4px 12px',
                    background: 'transparent',
                    border: `1px solid ${accent.violet.fg}`,
                    borderRadius: 4,
                    color: accent.violet.fg,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    letterSpacing: '0.02em',
                  }}
                >
                  Run ↵
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* xterm container */}
      <div
        ref={containerRef}
        style={{
          height: '100%',
          width: '100%',
          padding: '4px 0',
          background: surface.raised,
          overflow: 'hidden',
        }}
      />
    </div>
  )
}
