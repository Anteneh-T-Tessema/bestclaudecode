import { useState, useEffect, useCallback } from 'react'
import { Bot, Square, CheckCircle2, AlertCircle, Loader, CircleDot } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'
import { toast } from '../../store/useToastStore'

interface AgentProgress {
  sessionId: string
  planFile: string
  subtaskId: string
  subtaskDescription: string
  status: 'running' | 'done' | 'retrying' | 'blocked' | 'finished' | 'error'
  output?: string
  error?: string
  doneCount: number
  totalCount: number
}

type EventEntry = AgentProgress & { ts: number }

function StatusIcon({ status }: { status: AgentProgress['status'] }) {
  if (status === 'done') return <CheckCircle2 size={11} color={accent.green.fg} />
  if (status === 'blocked' || status === 'error') return <AlertCircle size={11} color={accent.red.fg} />
  if (status === 'running' || status === 'retrying') return <Loader size={11} color={accent.amber.fg} className="agent-pulse" />
  if (status === 'finished') return <CheckCircle2 size={11} color={accent.cyan.fg} />
  return <CircleDot size={11} color={fg[4]} />
}

export function AgentProgressPanel() {
  const [events, setEvents] = useState<EventEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    const off = window.api.agent.onProgress((raw: unknown) => {
      const p = raw as AgentProgress
      setEvents((prev) => [...prev.slice(-99), { ...p, ts: Date.now() }])
      if (p.status === 'running' || p.status === 'retrying') setIsRunning(true)
      if (p.status === 'finished' || p.status === 'blocked' || p.status === 'error') setIsRunning(false)
    })

    window.api.agent.getActiveSession().then((id) => setIsRunning(!!id))

    return off
  }, [])

  const stop = useCallback(async () => {
    await window.api.agent.stopAutonomous()
    setIsRunning(false)
    toast.success('Agent stopped')
  }, [])

  const clear = useCallback(() => setEvents([]), [])

  const latest = events.length > 0 ? events[events.length - 1] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Bot style={{ width: 13, height: 13, color: accent.violet.fg }} />}
        label="Agent"
        actions={
          <div style={{ display: 'flex', gap: 4 }}>
            {isRunning && (
              <button
                type="button"
                onClick={stop}
                title="Stop agent"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                  background: accent.red.subtle, border: `1px solid ${accent.red.border}`,
                  color: accent.red.fg, cursor: 'pointer',
                }}
              >
                <Square size={9} /> Stop
              </button>
            )}
            <button
              type="button"
              onClick={clear}
              title="Clear log"
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 4,
                background: 'transparent', border: `1px solid ${border[1]}`,
                color: fg[3], cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        }
      />

      {/* Current status banner */}
      {latest && (
        <div
          style={{
            padding: '8px 12px',
            borderBottom: `1px solid ${border[1]}`,
            background: surface.raised,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <StatusIcon status={latest.status} />
            <span style={{ fontSize: 11, fontWeight: 600, color: fg[0] }}>
              {latest.status === 'finished' ? 'Finished' :
               latest.status === 'blocked' ? 'Blocked' :
               latest.status === 'error' ? 'Error' :
               latest.status === 'retrying' ? 'Retrying…' : 'Running'}
            </span>
            <span style={{ fontSize: 10, color: fg[4], marginLeft: 'auto' }}>
              {latest.doneCount}/{latest.totalCount}
            </span>
          </div>
          {latest.subtaskDescription && (
            <div style={{ fontSize: 11, color: fg[2], paddingLeft: 17, lineHeight: 1.4 }}>
              [{latest.subtaskId}] {latest.subtaskDescription}
            </div>
          )}
          {(latest.error) && (
            <div style={{ fontSize: 10, color: accent.red.fg, paddingLeft: 17, marginTop: 3 }}>
              {latest.error}
            </div>
          )}
        </div>
      )}

      {/* Event log */}
      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace' }}>
        {events.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: fg[4], fontSize: 11 }}>
            No agent activity yet. Start an autonomous run from the Task Planner panel.
          </div>
        )}
        {events.map((e, i) => (
          <div
            key={i}
            style={{
              padding: '5px 12px',
              borderBottom: `1px solid ${border[2]}`,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
            }}
          >
            <StatusIcon status={e.status} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: fg[2], display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>{e.status}</span>
                <span style={{ color: fg[4] }}>{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
              {e.subtaskDescription && (
                <div style={{ fontSize: 10, color: fg[3], marginTop: 1 }}>
                  [{e.subtaskId}] {e.subtaskDescription.slice(0, 80)}{e.subtaskDescription.length > 80 ? '…' : ''}
                </div>
              )}
              {e.error && (
                <div style={{ fontSize: 10, color: accent.red.fg, marginTop: 1 }}>{e.error.slice(0, 120)}</div>
              )}
              {e.output && e.status === 'done' && (
                <div style={{ fontSize: 10, color: fg[4], marginTop: 1 }}>{e.output.slice(0, 100)}{e.output.length > 100 ? '…' : ''}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
