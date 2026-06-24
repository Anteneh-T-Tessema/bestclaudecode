import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Bot, Square, CheckCircle2, AlertCircle, Loader, CircleDot, Play, GitBranch, GitPullRequest, Rocket, History, ShieldAlert, X, Check } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'
import { toast } from '../../store/useToastStore'
import { useChatStore } from '../../store/useChatStore'

type Subtask = { id: string; description: string; depends_on: string[]; done: boolean }

interface AgentProgress {
  sessionId: string
  planFile: string
  subtaskId: string
  subtaskDescription: string
  status:
    | 'running' | 'done' | 'retrying' | 'blocked' | 'finished' | 'error'
    | 'preparing' | 'finalizing' | 'pr-opened' | 'push-failed-kept-locally'
    | 'deploying' | 'deployed' | 'pending-approval' | 'approval-rejected'
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
  if (status === 'pending-approval') return <ShieldAlert size={11} color={accent.violet.fg} />
  if (status === 'approval-rejected') return <AlertCircle size={11} color={accent.red.fg} />
  return <CircleDot size={11} color={fg[4]} />
}

function SubtaskIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 size={10} color={accent.green.fg} />
  if (status === 'blocked' || status === 'error') return <AlertCircle size={10} color={accent.red.fg} />
  if (status === 'running' || status === 'retrying') return <Loader size={10} color={accent.amber.fg} className="agent-pulse" />
  return <CircleDot size={10} color={fg[4]} />
}

function statusLabel(status: AgentProgress['status']): string {
  switch (status) {
    case 'preparing': return 'Preparing…'
    case 'finalizing': return 'Finalizing…'
    case 'pr-opened': return 'PR opened'
    case 'push-failed-kept-locally': return 'Kept locally'
    case 'deploying': return 'Deploying…'
    case 'deployed': return 'Deployed'
    case 'pending-approval': return 'Approval needed'
    case 'approval-rejected': return 'Rejected'
    case 'finished': return 'Finished'
    case 'blocked': return 'Blocked'
    case 'error': return 'Error'
    case 'retrying': return 'Retrying…'
    case 'done': return 'Done'
    default: return 'Running'
  }
}

function EventRow({ e }: { e: EventEntry }) {
  return (
    <div
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
  )
}

export function AgentProgressPanel() {
  const [events, setEvents] = useState<EventEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [goal, setGoal] = useState('')
  const [launching, setLaunching] = useState(false)
  const activeModel = useChatStore((s) => s.activeModel)
  const goalRef = useRef<HTMLInputElement>(null)

  // Gap 54 — history mode: browse the persisted event log of a past session.
  const [mode, setMode] = useState<'live' | 'history'>('live')
  const [historySessions, setHistorySessions] = useState<string[]>([])
  const [selectedSession, setSelectedSession] = useState('')
  const [historyEvents, setHistoryEvents] = useState<EventEntry[]>([])

  const toggleHistory = useCallback(async () => {
    if (mode === 'live') {
      const sessions = await window.api.agent.listEventSessions()
      setHistorySessions(sessions)
      if (sessions.length > 0) setSelectedSession(sessions[0])
      setMode('history')
    } else {
      setMode('live')
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'history' || !selectedSession) return
    window.api.agent.getEventLog(selectedSession).then((raw) => {
      setHistoryEvents(raw as unknown as EventEntry[])
    })
  }, [mode, selectedSession])

  // Gap 59 — subtask dependency graph for whichever event stream is active.
  const activeEvents = mode === 'live' ? events : historyEvents
  const planFile = activeEvents.length > 0 ? activeEvents[activeEvents.length - 1].planFile : ''
  const [planSubtasks, setPlanSubtasks] = useState<Subtask[]>([])

  useEffect(() => {
    if (!planFile) { setPlanSubtasks([]); return }
    window.api.taskPlanner.show(planFile).then((detail) => {
      setPlanSubtasks(detail?.subtasks ?? [])
    })
  }, [planFile])

  // Last known status per subtask id, derived from the event stream (authoritative
  // over the plan file's static `done` flag, which only updates on disk).
  const subtaskStatus = useMemo(() => {
    const map: Record<string, AgentProgress['status']> = {}
    for (const e of activeEvents) {
      if (e.subtaskId) map[e.subtaskId] = e.status
    }
    return map
  }, [activeEvents])

  useEffect(() => {
    const off = window.api.agent.onProgress((raw: unknown) => {
      const p = raw as AgentProgress
      setEvents((prev) => [...prev.slice(-99), { ...p, ts: Date.now() }])
      const activeStatuses: AgentProgress['status'][] = ['running', 'retrying', 'preparing', 'finalizing', 'deploying', 'pending-approval']
      const terminalStatuses: AgentProgress['status'][] = ['finished', 'blocked', 'error', 'pr-opened', 'push-failed-kept-locally', 'deployed', 'approval-rejected']
      if (activeStatuses.includes(p.status)) setIsRunning(true)
      if (p.status === 'pending-approval') toast.error(`Approval needed: ${p.error ?? ''}`)
      if (terminalStatuses.includes(p.status)) {
        setIsRunning(false)
        if (p.status === 'finished' || p.status === 'deployed') toast.success('Background agent finished all subtasks')
        if (p.status === 'pr-opened') toast.success(`PR opened: ${p.prUrl ?? ''}`)
        if (p.status === 'push-failed-kept-locally') toast.error('Push failed — branch kept locally')
        if (p.status === 'error') toast.error(`Agent error: ${p.error ?? 'unknown'}`)
        if (p.status === 'approval-rejected') toast.error('Agent halted — approval rejected')
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

  // Gap 51 — replay a past session's persisted log through the live view.
  const [isReplaying, setIsReplaying] = useState(false)
  const replay = useCallback(async () => {
    if (!selectedSession || isReplaying || isRunning) return
    setEvents([])
    setMode('live')
    setIsReplaying(true)
    try {
      const ok = await window.api.agent.replay(selectedSession)
      if (!ok) toast.error('Replay skipped — an agent session is already running')
    } finally {
      setIsReplaying(false)
    }
  }, [selectedSession, isReplaying, isRunning])

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
              onClick={toggleHistory}
              title="Browse past session event logs"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                background: mode === 'history' ? accent.violet.subtle : 'transparent',
                border: `1px solid ${mode === 'history' ? accent.violet.border : border[1]}`,
                color: mode === 'history' ? accent.violet.fg : fg[3], cursor: 'pointer',
              }}
            >
              <History size={9} /> {mode === 'history' ? 'Live' : 'History'}
            </button>
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

      {/* History mode — session picker over the persisted event log */}
      {mode === 'history' && (
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0, background: surface.base }}>
          <div style={{ fontSize: 10, color: fg[4], marginBottom: 4, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Past sessions
          </div>
          {historySessions.length === 0 ? (
            <div style={{ fontSize: 11, color: fg[4] }}>No recorded sessions yet.</div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={selectedSession}
                onChange={(e) => setSelectedSession(e.target.value)}
                title="Select past agent session"
                style={{
                  flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 5, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none',
                }}
              >
                {historySessions.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
              <button
                type="button"
                onClick={replay}
                disabled={isReplaying || isRunning}
                title="Replay this session's recorded events in the live view"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                  fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 5,
                  background: isReplaying || isRunning ? surface.raised : accent.violet.fg,
                  border: 'none', color: isReplaying || isRunning ? fg[4] : '#fff',
                  cursor: isReplaying || isRunning ? 'not-allowed' : 'pointer',
                }}
              >
                <Play size={11} /> {isReplaying ? 'Replaying…' : 'Replay'}
              </button>
            </div>
          )}
        </div>
      )}

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
          {latest.status === 'pending-approval' && (
            <div style={{ display: 'flex', gap: 6, paddingLeft: 17, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => window.api.agent.approve(latest.sessionId, true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                  background: accent.green.subtle, border: `1px solid ${accent.green.border}`,
                  color: accent.green.fg, cursor: 'pointer',
                }}
              >
                <Check size={10} /> Approve
              </button>
              <button
                type="button"
                onClick={() => window.api.agent.approve(latest.sessionId, false)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                  background: accent.red.subtle, border: `1px solid ${accent.red.border}`,
                  color: accent.red.fg, cursor: 'pointer',
                }}
              >
                <X size={10} /> Reject
              </button>
            </div>
          )}
        </div>
      )}

      {/* Subtask dependency graph (Gap 59) — flat list with explicit "needs:" annotations
          rather than a nested tree, since depends_on can have multiple parents (a DAG, not
          strictly a tree), and nesting would misrepresent that. */}
      {planSubtasks.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0, maxHeight: 160, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, color: fg[4], marginBottom: 4, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Subtasks ({planSubtasks.filter((s) => (subtaskStatus[s.id] ?? (s.done ? 'done' : 'pending')) === 'done').length}/{planSubtasks.length})
          </div>
          {planSubtasks.map((s) => {
            const status = subtaskStatus[s.id] ?? (s.done ? 'done' : 'pending')
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '2px 0' }}>
                <SubtaskIcon status={status} />
                <span style={{ color: fg[2], flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 1.4 }}>
                  [{s.id}] {s.description}
                  {s.depends_on.length > 0 && (
                    <span style={{ color: fg[4] }}> (needs: {s.depends_on.join(', ')})</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Event log — live session events, or the persisted log of a past session */}
      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace' }}>
        {mode === 'live' ? (
          <>
            {events.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: fg[4], fontSize: 11 }}>
                No agent activity yet. Start an autonomous run from the Task Planner panel.
              </div>
            )}
            {events.map((e, i) => <EventRow key={i} e={e} />)}
          </>
        ) : (
          <>
            {historyEvents.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: fg[4], fontSize: 11 }}>
                {selectedSession ? 'No events recorded for this session.' : 'Select a session above.'}
              </div>
            )}
            {historyEvents.map((e, i) => <EventRow key={i} e={e} />)}
          </>
        )}
      </div>
    </div>
  )
}
