import { useState, useEffect, useCallback, useRef } from 'react'
import { Bot, Square, CheckCircle2, AlertCircle, Loader, CircleDot, Play, GitBranch, GitPullRequest, Rocket } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'
import { toast } from '../../store/useToastStore'
import { useChatStore } from '../../store/useChatStore'

interface AgentProgress {
  sessionId: string
  planFile: string
  subtaskId: string
  subtaskDescription: string
  status:
    | 'running' | 'done' | 'retrying' | 'blocked' | 'finished' | 'error'
    | 'preparing' | 'finalizing' | 'pr-opened' | 'push-failed-kept-locally'
    | 'deploying' | 'deployed'
  output?: string
  error?: string
  doneCount: number
  totalCount: number
  prUrl?: string
  deployUrl?: string
  branch?: string
}

type EventEntry = AgentProgress & { ts: number }

function StatusIcon({ status }: { status: AgentProgress['status'] }) {
  if (status === 'done') return <CheckCircle2 size={11} color={accent.green.fg} />
  if (status === 'blocked' || status === 'error') return <AlertCircle size={11} color={accent.red.fg} />
  if (status === 'running' || status === 'retrying') return <Loader size={11} color={accent.amber.fg} className="agent-pulse" />
  if (status === 'finished' || status === 'deployed') return <CheckCircle2 size={11} color={accent.cyan.fg} />
  if (status === 'pr-opened') return <GitPullRequest size={11} color={accent.violet.fg} />
  if (status === 'preparing' || status === 'finalizing') return <GitBranch size={11} color={accent.amber.fg} />
  if (status === 'deploying') return <Rocket size={11} color={accent.amber.fg} />
  if (status === 'push-failed-kept-locally') return <AlertCircle size={11} color={accent.amber.fg} />
  return <CircleDot size={11} color={fg[4]} />
}

function statusLabel(status: AgentProgress['status']): string {
  switch (status) {
    case 'preparing': return 'Preparing…'
    case 'finalizing': return 'Finalizing…'
    case 'pr-opened': return 'PR opened'
    case 'push-failed-kept-locally': return 'Kept locally'
    case 'deploying': return 'Deploying…'
    case 'deployed': return 'Deployed'
    case 'finished': return 'Finished'
    case 'blocked': return 'Blocked'
    case 'error': return 'Error'
    case 'retrying': return 'Retrying…'
    case 'done': return 'Done'
    default: return 'Running'
  }
}

export function AgentProgressPanel() {
  const [events, setEvents] = useState<EventEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [goal, setGoal] = useState('')
  const [launching, setLaunching] = useState(false)
  const activeModel = useChatStore((s) => s.activeModel)
  const goalRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const off = window.api.agent.onProgress((raw: unknown) => {
      const p = raw as AgentProgress
      setEvents((prev) => [...prev.slice(-99), { ...p, ts: Date.now() }])
      const activeStatuses: AgentProgress['status'][] = ['running', 'retrying', 'preparing', 'finalizing', 'deploying']
      const terminalStatuses: AgentProgress['status'][] = ['finished', 'blocked', 'error', 'pr-opened', 'push-failed-kept-locally', 'deployed']
      if (activeStatuses.includes(p.status)) setIsRunning(true)
      if (terminalStatuses.includes(p.status)) {
        setIsRunning(false)
        if (p.status === 'finished' || p.status === 'deployed') toast.success('Background agent finished all subtasks')
        if (p.status === 'pr-opened') toast.success(`PR opened: ${p.prUrl ?? ''}`)
        if (p.status === 'push-failed-kept-locally') toast.error('Push failed — branch kept locally')
        if (p.status === 'error') toast.error(`Agent error: ${p.error ?? 'unknown'}`)
      }
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

  const launch = useCallback(async () => {
    const trimmed = goal.trim()
    if (!trimmed || isRunning || launching) return
    setLaunching(true)
    try {
      const detail = await window.api.taskPlanner.create(trimmed)
      if (!detail?.slug) { toast.error('Failed to create plan'); return }
      const plans = await window.api.taskPlanner.list()
      const summary = plans.find((p) => p.slug === detail.slug)
      if (!summary?.path) { toast.error('Could not locate plan file'); return }
      await window.api.agent.startAutonomous({ planFile: summary.path, model: activeModel })
      setGoal('')
      setIsRunning(true)
      toast.success('Background agent started')
    } catch (err) {
      toast.error(`Launch failed: ${(err as Error).message}`)
    } finally {
      setLaunching(false)
    }
  }, [goal, isRunning, launching, activeModel])

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

      {/* Goal input — launch a new background agent */}
      {!isRunning && (
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0, background: surface.base }}>
          <div style={{ fontSize: 10, color: fg[4], marginBottom: 4, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            New background agent
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={goalRef}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') launch() }}
              placeholder="Describe a long-horizon goal…"
              style={{
                flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                borderRadius: 5, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={launch}
              disabled={!goal.trim() || launching}
              style={{
                background: goal.trim() && !launching ? accent.violet.fg : surface.raised,
                border: 'none', borderRadius: 5, padding: '5px 10px', cursor: goal.trim() && !launching ? 'pointer' : 'not-allowed',
                color: goal.trim() && !launching ? '#fff' : fg[4],
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}
            >
              {launching ? <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={11} />}
              {launching ? 'Launching…' : 'Run'}
            </button>
          </div>
        </div>
      )}

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
              {statusLabel(latest.status)}
            </span>
            {latest.branch && (
              <span style={{ fontSize: 9, color: fg[4], fontFamily: 'monospace' }}>{latest.branch}</span>
            )}
            <span style={{ fontSize: 10, color: fg[4], marginLeft: 'auto' }}>
              {latest.doneCount}/{latest.totalCount}
            </span>
          </div>
          {latest.subtaskDescription && (
            <div style={{ fontSize: 11, color: fg[2], paddingLeft: 17, lineHeight: 1.4 }}>
              {latest.subtaskId ? `[${latest.subtaskId}] ` : ''}{latest.subtaskDescription}
            </div>
          )}
          {latest.prUrl && (
            <div style={{ fontSize: 10, color: accent.violet.fg, paddingLeft: 17, marginTop: 3 }}>
              PR: <a href={latest.prUrl} style={{ color: accent.violet.fg }}>{latest.prUrl}</a>
            </div>
          )}
          {latest.deployUrl && (
            <div style={{ fontSize: 10, color: accent.cyan.fg, paddingLeft: 17, marginTop: 2 }}>
              Deployed: <a href={latest.deployUrl} style={{ color: accent.cyan.fg }}>{latest.deployUrl}</a>
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
