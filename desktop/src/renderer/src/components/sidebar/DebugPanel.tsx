import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, StepForward, ArrowDownToDot, ArrowUpFromDot, Square, Plus, Trash2, Bug } from 'lucide-react'
import { useDebugStore } from '../../store/useDebugStore'
import { useEditorStore } from '../../store/useEditorStore'
import { PanelHeader, IconButton, accent, border, fg, surface } from '../../design'
import { EmptyState } from '../EmptyState'

// ── Step controls toolbar ─────────────────────────────────────────────────────

function DebugToolbar() {
  const { status, activeThreadId, reset } = useDebugStore()
  const activeTab = useEditorStore((s) => s.getActiveTab())

  const handleLaunch = useCallback(async () => {
    if (!activeTab) return
    reset()
    const bps = useDebugStore.getState().breakpoints[activeTab.filePath] ?? []
    const result = await window.api.dap.launch({
      program: activeTab.filePath,
      language: activeTab.language === 'python' ? 'python' : 'node',
    })
    if (!result.started) return
    await window.api.dap.setBreakpoints({ path: activeTab.filePath, breakpoints: bps })
    useDebugStore.getState().setStatus('running')
  }, [activeTab, reset])

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    opacity: disabled ? 0.35 : 1,
    pointerEvents: disabled ? 'none' : 'auto',
  })

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '4px 8px',
        borderBottom: `1px solid ${border[1]}`,
        flexShrink: 0,
      }}
    >
      <IconButton size={24} title="Start / Resume" onClick={
        status === 'stopped'
          ? () => void window.api.dap.continue({ threadId: activeThreadId })
          : () => void handleLaunch()
      }>
        <Play style={{ width: 12, height: 12, color: accent.green.fg }} />
      </IconButton>

      <div style={btnStyle(status !== 'stopped')}>
        <IconButton size={24} title="Step Over"
          onClick={() => void window.api.dap.next({ threadId: activeThreadId })}>
          <StepForward style={{ width: 12, height: 12 }} />
        </IconButton>
      </div>

      <div style={btnStyle(status !== 'stopped')}>
        <IconButton size={24} title="Step Into"
          onClick={() => void window.api.dap.stepIn({ threadId: activeThreadId })}>
          <ArrowDownToDot style={{ width: 12, height: 12 }} />
        </IconButton>
      </div>

      <div style={btnStyle(status !== 'stopped')}>
        <IconButton size={24} title="Step Out"
          onClick={() => void window.api.dap.stepOut({ threadId: activeThreadId })}>
          <ArrowUpFromDot style={{ width: 12, height: 12 }} />
        </IconButton>
      </div>

      <div style={{ flex: 1 }} />

      <div style={btnStyle(status === 'idle')}>
        <IconButton size={24} title="Stop" onClick={async () => {
          await window.api.dap.disconnect()
          reset()
        }}>
          <Square style={{ width: 10, height: 10, color: accent.red.fg }} />
        </IconButton>
      </div>
    </div>
  )
}

// ── Call stack ────────────────────────────────────────────────────────────────

function CallStack() {
  const { stackFrames, activeFrameId, setActiveFrame } = useDebugStore()
  if (stackFrames.length === 0) return null

  return (
    <div style={{ borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
      <div style={{ padding: '4px 10px 2px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: fg[3] }}>
        CALL STACK
      </div>
      {stackFrames.map((frame) => (
        <div
          key={frame.id}
          onClick={async () => {
            const vars = await window.api.dap.variables({ frameId: frame.id })
            setActiveFrame(frame.id, vars)
          }}
          style={{
            padding: '3px 10px',
            cursor: 'pointer',
            background: frame.id === activeFrameId ? surface.raised : 'transparent',
            borderLeft: frame.id === activeFrameId ? `2px solid ${accent.blue.fg}` : '2px solid transparent',
          }}
        >
          <div style={{ fontSize: 11, color: frame.id === activeFrameId ? fg[0] : fg[2], fontFamily: 'monospace' }}>
            {frame.name}
          </div>
          {frame.source?.path && (
            <div style={{ fontSize: 10, color: fg[4] }}>
              {frame.source.path.split('/').pop()}:{frame.line}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Variables list ────────────────────────────────────────────────────────────

function Variables() {
  const { variables } = useDebugStore()
  if (variables.length === 0) return null

  return (
    <div style={{ borderBottom: `1px solid ${border[1]}`, maxHeight: 200, overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ padding: '4px 10px 2px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: fg[3] }}>
        VARIABLES
      </div>
      {variables.map((v) => (
        <div
          key={v.name}
          style={{ padding: '2px 10px', display: 'flex', gap: 8, alignItems: 'baseline' }}
        >
          <span style={{ fontSize: 11, color: accent.cyan.fg, fontFamily: 'monospace', minWidth: 80, flexShrink: 0 }}>
            {v.name}
          </span>
          <span style={{ fontSize: 11, color: fg[1], fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {v.value}
          </span>
          {v.type && (
            <span style={{ fontSize: 10, color: fg[4], marginLeft: 'auto', flexShrink: 0 }}>
              {v.type}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Breakpoints (Gap 97 — conditional breakpoints) ───────────────────────────

function BreakpointsPanel() {
  const breakpoints = useDebugStore((s) => s.breakpoints)
  const setBreakpointCondition = useDebugStore((s) => s.setBreakpointCondition)
  const toggleBreakpoint = useDebugStore((s) => s.toggleBreakpoint)
  const status = useDebugStore((s) => s.status)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const entries = Object.entries(breakpoints).flatMap(([file, bps]) => bps.map((bp) => ({ file, ...bp })))
  if (entries.length === 0) return null

  const commitCondition = async (file: string, line: number) => {
    setBreakpointCondition(file, line, draft.trim())
    setEditingKey(null)
    // Push the updated condition to a live session immediately.
    if (status !== 'idle') {
      const updated = useDebugStore.getState().breakpoints[file] ?? []
      await window.api.dap.setBreakpoints({ path: file, breakpoints: updated })
    }
  }

  return (
    <div style={{ borderBottom: `1px solid ${border[1]}`, flexShrink: 0, maxHeight: 140, overflowY: 'auto' }}>
      <div style={{ padding: '4px 10px 2px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: fg[3] }}>
        BREAKPOINTS
      </div>
      {entries.map(({ file, line, condition }) => {
        const key = `${file}:${line}`
        const isEditing = editingKey === key
        return (
          <div key={key} style={{ padding: '2px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: fg[1], fontFamily: 'monospace', flexShrink: 0 }}>
              {file.split('/').pop()}:{line}
            </span>
            {isEditing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void commitCondition(file, line)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitCondition(file, line)
                  if (e.key === 'Escape') setEditingKey(null)
                }}
                placeholder="condition (e.g. i == 5)"
                style={{
                  flex: 1, background: surface.raised, border: `1px solid ${accent.amber.fg}`,
                  borderRadius: 3, padding: '2px 5px', fontSize: 10.5, color: fg[0], outline: 'none', fontFamily: 'monospace',
                }}
              />
            ) : (
              <span
                onClick={() => { setEditingKey(key); setDraft(condition ?? '') }}
                title="Click to edit condition"
                style={{
                  flex: 1, fontSize: 10.5, fontFamily: 'monospace', cursor: 'text',
                  color: condition ? accent.amber.fg : fg[4],
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {condition ? `if: ${condition}` : 'no condition — click to add'}
              </span>
            )}
            <IconButton size={18} onClick={() => toggleBreakpoint(file, line)} title="Remove">
              <Trash2 style={{ width: 10, height: 10 }} />
            </IconButton>
          </div>
        )
      })}
    </div>
  )
}

// ── Watch expressions ─────────────────────────────────────────────────────────

function WatchPanel() {
  const { watchExpressions, watchResults, addWatch, removeWatch, status } = useDebugStore()
  const [draft, setDraft] = useState('')

  const evaluateAll = useCallback(async () => {
    if (status !== 'stopped') return
    for (const expr of watchExpressions) {
      const result = await window.api.dap.evaluate({ expression: expr }).catch(() => '')
      useDebugStore.getState().setWatchResult(expr, result)
    }
  }, [watchExpressions, status])

  useEffect(() => { void evaluateAll() }, [evaluateAll])

  return (
    <div style={{ borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
      <div style={{ padding: '4px 10px 2px', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: fg[3] }}>
        WATCH
      </div>
      {watchExpressions.map((expr) => (
        <div key={expr} style={{ padding: '2px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: accent.amber.fg, fontFamily: 'monospace', flex: 1 }}>{expr}</span>
          <span style={{ fontSize: 11, color: fg[2], fontFamily: 'monospace' }}>
            {watchResults[expr] ?? '—'}
          </span>
          <IconButton size={18} onClick={() => removeWatch(expr)} title="Remove">
            <Trash2 style={{ width: 10, height: 10 }} />
          </IconButton>
        </div>
      ))}
      <div style={{ display: 'flex', padding: '4px 10px', gap: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) { addWatch(draft.trim()); setDraft('') }
          }}
          placeholder="Add expression…"
          style={{
            flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
            borderRadius: 3, padding: '3px 6px', fontSize: 11, color: fg[0], outline: 'none',
          }}
        />
        <IconButton size={22} title="Add" onClick={() => { if (draft.trim()) { addWatch(draft.trim()); setDraft('') } }}>
          <Plus style={{ width: 11, height: 11 }} />
        </IconButton>
      </div>
    </div>
  )
}

// ── Output console ────────────────────────────────────────────────────────────

function DebugOutput() {
  const { output } = useDebugStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output.length])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px' }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: fg[3], marginBottom: 4 }}>
        OUTPUT
      </div>
      {output.map((entry, i) => (
        <div
          key={i}
          style={{
            fontSize: 11,
            color: entry.category === 'stderr' ? accent.red.fg : fg[2],
            fontFamily: 'monospace',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {entry.text}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

// ── Main debug panel ──────────────────────────────────────────────────────────

export function DebugPanel() {
  const { status, setStopped, setStatus, appendOutput, reset } = useDebugStore()

  // Wire DAP push events from the host (Electron IPC or WebSocket)
  useEffect(() => {
    const unsubs = [
      window.api.dap.onStopped(async (body) => {
        const threadId = body.threadId ?? 1
        const [frames, vars] = await Promise.all([
          window.api.dap.stackTrace({ threadId }),
          window.api.dap.variables({ frameId: 0 }),
        ])
        setStopped(threadId, frames, vars)
        // Navigate editor to the stopped line
        const top = frames[0]
        if (top?.source?.path && top.line) {
          window.dispatchEvent(new CustomEvent('lakoora:goToLine', {
            detail: { line: top.line, filePath: top.source.path },
          }))
        }
      }),
      window.api.dap.onContinued(() => setStatus('running')),
      window.api.dap.onTerminated(() => { setStatus('terminated'); reset() }),
      window.api.dap.onOutput((body) => appendOutput({ text: body.output, category: body.category })),
    ]
    return () => { unsubs.forEach((u) => u()) }
  }, [setStopped, setStatus, appendOutput, reset])

  const statusLabel: Record<typeof status, string> = {
    idle: 'Not running',
    running: 'Running',
    stopped: 'Paused',
    terminated: 'Terminated',
  }
  const statusColor: Record<typeof status, string> = {
    idle: fg[4],
    running: accent.green.fg,
    stopped: accent.amber.fg,
    terminated: fg[3],
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Bug style={{ width: 13, height: 13, color: accent.red.fg }} />}
        label="Debug"
        actions={
          <span style={{ fontSize: 10, color: statusColor[status] }}>{statusLabel[status]}</span>
        }
      />

      <DebugToolbar />

      <BreakpointsPanel />

      {status === 'idle' && (
        <EmptyState
          icon={<Bug size={20} />}
          title="Not debugging"
          description="Open a Python or Node file and click the play button to start a debug session. Click in the gutter to set breakpoints."
        />
      )}

      {status !== 'idle' && (
        <>
          <CallStack />
          <Variables />
          <WatchPanel />
          <DebugOutput />
        </>
      )}
    </div>
  )
}
