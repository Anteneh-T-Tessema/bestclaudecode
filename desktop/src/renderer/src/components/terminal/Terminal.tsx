import { useEffect, useRef, useCallback } from 'react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useAppStore } from '../../store/useAppStore'
import { surface } from '../../design'

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const termIdRef = useRef<string | null>(null)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const fontSize = useSettingsStore((s) => s.fontSize)

  const initTerminal = useCallback(async () => {
    if (!containerRef.current) return

    const { Terminal: XTerm } = await import('@xterm/xterm')
    const { FitAddon } = await import('@xterm/addon-fit')
    const { WebLinksAddon } = await import('@xterm/addon-web-links')

    const term = new XTerm({
      fontSize: fontSize - 1,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
      theme: {
        background: surface.raised,
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
  )
}
