import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Bot, Square, CheckCircle2, AlertCircle, Loader, CircleDot, Play, GitBranch, GitPullRequest, Rocket, History, ShieldAlert, X, Check, Copy, ExternalLink } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'
import { toast } from '../../store/useToastStore'
import { useChatStore } from '../../store/useChatStore'

interface DiffLine {
  type: 'add' | 'delete' | 'normal';
  content: string;
  numOld?: number;
  numNew?: number;
}

interface ParsedFileDiff {
  path: string;
  name: string;
  type: 'added' | 'deleted' | 'modified';
  lines: DiffLine[];
}

function parseGitDiff(diff: string): ParsedFileDiff[] {
  if (!diff) return []
  const files: ParsedFileDiff[] = []
  const parts = diff.split(/^diff --git /m)
  
  for (const part of parts) {
    if (!part.trim()) continue
    const lines = part.split('\n')
    const headerLine = lines[0]
    
    let filePath = ''
    const bMatch = headerLine.match(/\sb\/(.+)$/)
    if (bMatch) {
      filePath = bMatch[1]
    } else {
      const tokens = headerLine.split(' ')
      filePath = tokens[tokens.length - 1].replace(/^[ab]\//, '')
    }
    
    if (!filePath) continue
    
    const parsedLines: DiffLine[] = []
    let type: 'added' | 'deleted' | 'modified' = 'modified'
    let lnOld = 0
    let lnNew = 0
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('new file mode')) {
        type = 'added'
        continue
      }
      if (line.startsWith('deleted file mode')) {
        type = 'deleted'
        continue
      }
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ')) {
        continue
      }
      
      if (line.startsWith('@@')) {
        const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (hunkMatch) {
          lnOld = parseInt(hunkMatch[1], 10)
          lnNew = parseInt(hunkMatch[2], 10)
        }
        parsedLines.push({ type: 'normal', content: line })
        continue
      }
      
      if (line.startsWith('+')) {
        parsedLines.push({ type: 'add', content: line.slice(1), numNew: lnNew++ })
      } else if (line.startsWith('-')) {
        parsedLines.push({ type: 'delete', content: line.slice(1), numOld: lnOld++ })
      } else {
        parsedLines.push({ type: 'normal', content: line.slice(1), numOld: lnOld++, numNew: lnNew++ })
      }
    }
    
    files.push({
      path: filePath,
      name: filePath.split('/').pop() || filePath,
      type,
      lines: parsedLines,
    })
  }
  return files
}


type Subtask = { id: string; description: string; depends_on: string[]; done: boolean }
type SessionSummary = { id: string; branch?: string; startedAt: number }
type VerifyResult = { valid: boolean; brokenAtSeq?: number; totalEvents: number }
type ShadowInfo = { id: string; path: string; branch: string; base_ref: string; repo_root: string }

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
  /** Gap 142 — set on 'retrying'; retryCount is 0-indexed (completed failures so far). */
  retryCount?: number
  maxRetries?: number
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

function statusLabel(status: AgentProgress['status'], retryCount?: number, maxRetries?: number): string {
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
    // Gap 142 — retryCount is 0-indexed (completed failures so far), so the
    // attempt ordinal shown to the user is retryCount + 1.
    case 'retrying': return retryCount != null && maxRetries != null
      ? `Retrying… (attempt ${retryCount + 1}/${maxRetries})`
      : 'Retrying…'
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
          <span style={{ fontWeight: 600 }}>
            {e.status}
            {e.status === 'retrying' && e.retryCount != null && e.maxRetries != null
              ? ` (attempt ${e.retryCount + 1}/${e.maxRetries})`
              : ''}
          </span>
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
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set())
  const isRunning = runningSessionIds.size > 0
  const [goal, setGoal] = useState('')
  const [launching, setLaunching] = useState(false)
  const activeModel = useChatStore((s) => s.activeModel)
  const goalRef = useRef<HTMLInputElement>(null)

  const [selectedLiveSessionId, setSelectedLiveSessionId] = useState('')

  // Gap 54 — history mode: browse the persisted event log of a past session.
  const [mode, setMode] = useState<'live' | 'history'>('live')
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([])
  const [sessionFilter, setSessionFilter] = useState('') // Gap 69
  const [selectedSession, setSelectedSession] = useState('')
  const [historyEvents, setHistoryEvents] = useState<EventEntry[]>([])

  const toggleHistory = useCallback(async () => {
    if (mode === 'live') {
      const sessions = await window.api.agent.listEventSessions()
      setHistorySessions(sessions)
      if (sessions.length > 0) setSelectedSession(sessions[0].id)
      setMode('history')
    } else {
      setMode('live')
    }
  }, [mode])

  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase()
    if (!q) return historySessions
    return historySessions.filter((s) => s.id.toLowerCase().includes(q) || (s.branch ?? '').toLowerCase().includes(q))
  }, [historySessions, sessionFilter])

  useEffect(() => {
    if (mode !== 'history' || !selectedSession) return
    window.api.agent.getEventLog(selectedSession).then((raw) => {
      setHistoryEvents(raw as unknown as EventEntry[])
    })
  }, [mode, selectedSession])

  // Gap 60 — verify the selected session's event log hash chain on demand.
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const verifySelected = useCallback(async () => {
    if (!selectedSession) return
    setVerifyResult(await window.api.agent.verifyEventLog(selectedSession))
  }, [selectedSession])
  useEffect(() => { setVerifyResult(null) }, [selectedSession])

  // Gap 65 — recover the code diff a past session produced, even after its worktree was cleaned up.
  const [sessionDiff, setSessionDiff] = useState<string | null>(null)
  const selectedBranch = historySessions.find((s) => s.id === selectedSession)?.branch
  const viewDiff = useCallback(async () => {
    if (!selectedBranch) return
    setSessionDiff(await window.api.agent.getSessionDiff(selectedBranch))
  }, [selectedBranch])
  useEffect(() => { setSessionDiff(null) }, [selectedSession])

  // Gap 66 — render the session's verification report (if any) as standalone HTML for sharing.
  const exportReport = useCallback(async () => {
    if (!selectedSession) return
    const htmlPath = await window.api.agent.exportReportHtml(selectedSession)
    if (htmlPath) toast.success(`Report exported to ${htmlPath}`)
    else toast.error('No verification report found for this session')
  }, [selectedSession])

  // Gap 76 — export the session report as PDF.
  const exportReportPdf = useCallback(async () => {
    if (!selectedSession) return
    const pdfPath = await window.api.agent.exportReportPdf(selectedSession)
    if (pdfPath) toast.success(`PDF exported to ${pdfPath}`)
    else toast.error('PDF export failed — try HTML export first')
  }, [selectedSession])

  const exportComplianceJson = useCallback(async () => {
    if (!selectedSession) return
    const jsonPath = await window.api.agent.getComplianceJson(selectedSession)
    if (jsonPath) toast.success(`JSON report written to ${jsonPath}`)
    else toast.error('No events found for this session')
  }, [selectedSession])

  const liveSessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of events) {
      if (e.sessionId) ids.add(e.sessionId)
    }
    for (const id of runningSessionIds) {
      ids.add(id)
    }
    return Array.from(ids)
  }, [events, runningSessionIds])

  const activeLiveSessionId = selectedLiveSessionId || (liveSessionIds.length > 0 ? liveSessionIds[liveSessionIds.length - 1] : '')

  const filteredLiveEvents = useMemo(() => {
    if (!activeLiveSessionId) return events
    return events.filter((e) => e.sessionId === activeLiveSessionId)
  }, [events, activeLiveSessionId])

  useEffect(() => {
    const handleFocus = (e: Event) => {
      const customEv = e as CustomEvent<{ sessionId: string; mode: 'live' | 'history' }>
      if (!customEv.detail) return
      const { sessionId, mode: targetMode } = customEv.detail
      setMode(targetMode)
      if (targetMode === 'live') {
        setSelectedLiveSessionId(sessionId)
      } else {
        setSelectedSession(sessionId)
        window.api.agent.listEventSessions().then((sessions) => {
          setHistorySessions(sessions)
        })
      }
    }
    window.addEventListener('focus-agent-session', handleFocus)
    return () => {
      window.removeEventListener('focus-agent-session', handleFocus)
    }
  }, [])

  // Gap 59 — subtask dependency graph for whichever event stream is active.
  const activeEvents = mode === 'live' ? filteredLiveEvents : historyEvents
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
      if (activeStatuses.includes(p.status)) {
        setRunningSessionIds((prev) => new Set([...prev, p.sessionId]))
      }
      if (p.status === 'pending-approval') toast.error(`Approval needed: ${p.error ?? ''}`)
      if (terminalStatuses.includes(p.status)) {
        setRunningSessionIds((prev) => { const s = new Set(prev); s.delete(p.sessionId); return s })
        if (p.status === 'finished' || p.status === 'deployed') toast.success(`Agent session finished`)
        if (p.status === 'pr-opened') toast.success(`PR opened: ${p.prUrl ?? ''}`)
        if (p.status === 'push-failed-kept-locally') toast.error('Push failed — branch kept locally')
        if (p.status === 'error') toast.error(`Agent error: ${p.error ?? 'unknown'}`)
        if (p.status === 'approval-rejected') toast.error('Agent halted — approval rejected')
      }
    })

    window.api.agent.getActiveSessions().then((ids) => setRunningSessionIds(new Set(ids)))

    return off
  }, [])

  const stop = useCallback(async () => {
    if (activeLiveSessionId) {
      await window.api.agent.stopAutonomous(activeLiveSessionId)
      setRunningSessionIds((prev) => {
        const s = new Set(prev)
        s.delete(activeLiveSessionId)
        return s
      })
      toast.success(`Stopped agent session ${activeLiveSessionId.slice(0, 8)}`)
    } else {
      const ids = [...runningSessionIds]
      await Promise.all(ids.map((id) => window.api.agent.stopAutonomous(id)))
      setRunningSessionIds(new Set())
      toast.success(ids.length > 1 ? `Stopped ${ids.length} agent sessions` : 'Agent stopped')
    }
  }, [activeLiveSessionId, runningSessionIds])

  const clear = useCallback(() => setEvents([]), [])

  // Gap 51/68 — replay a past session's persisted log through the live view, at a chosen speed.
  const [isReplaying, setIsReplaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(10)
  const replay = useCallback(async () => {
    if (!selectedSession || isReplaying || isRunning) return
    setEvents([])
    setMode('live')
    setIsReplaying(true)
    try {
      const ok = await window.api.agent.replay(selectedSession, replaySpeed)
      if (!ok) toast.error('Replay skipped — an agent session is already running')
    } finally {
      setIsReplaying(false)
    }
  }, [selectedSession, isReplaying, isRunning, replaySpeed])

  // Gap 86 — shadow workspace: isolated branch the agent can write to, reviewed
  // and explicitly promoted or discarded rather than landing directly on the working tree.
  const [shadow, setShadow] = useState<ShadowInfo | null>(null)
  const [shadowDiff, setShadowDiff] = useState<string | null>(null)
  const [shadowBusy, setShadowBusy] = useState(false)
  const [shadowDiffOpen, setShadowDiffOpen] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({})
  const parsedDiff = useMemo(() => parseGitDiff(shadowDiff || ''), [shadowDiff])

  const createShadow = useCallback(async () => {
    setShadowBusy(true)
    try {
      const info = await window.api.agent.createShadow()
      if (info) {
        setShadow(info)
        toast.success(`Shadow workspace created on ${info.branch}`)
      } else {
        toast.error('Failed to create shadow workspace')
      }
    } finally {
      setShadowBusy(false)
    }
  }, [])

  const toggleShadowDiff = useCallback(async () => {
    if (!shadow) return
    if (shadowDiffOpen) { setShadowDiffOpen(false); return }
    const diff = await window.api.agent.getShadowDiffVsBase(shadow.id)
    setShadowDiff(diff ?? '(no changes)')
    setShadowDiffOpen(true)
  }, [shadow, shadowDiffOpen])

  const promoteShadow = useCallback(async () => {
    if (!shadow) return
    setShadowBusy(true)
    try {
      const ok = await window.api.agent.promoteShadow(shadow.id)
      if (ok) {
        toast.success('Shadow workspace promoted to working tree')
        setShadow(null)
        setShadowDiff(null)
        setShadowDiffOpen(false)
      } else {
        toast.error('Failed to promote shadow workspace')
      }
    } finally {
      setShadowBusy(false)
    }
  }, [shadow])

  const discardShadow = useCallback(async () => {
    if (!shadow) return
    setShadowBusy(true)
    try {
      const ok = await window.api.agent.discardShadow(shadow.id)
      if (ok) {
        toast.success('Shadow workspace discarded')
        setShadow(null)
        setShadowDiff(null)
        setShadowDiffOpen(false)
      } else {
        toast.error('Failed to discard shadow workspace')
      }
    } finally {
      setShadowBusy(false)
    }
  }, [shadow])

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
      const sessionId = await window.api.agent.startAutonomous({ planFile: summary.path, model: activeModel })
      setGoal('')
      if (sessionId) {
        setRunningSessionIds((prev) => new Set([...prev, sessionId]))
        setSelectedLiveSessionId(sessionId)
      }
      toast.success('Background agent started')
    } catch (err) {
      toast.error(`Launch failed: ${(err as Error).message}`)
    } finally {
      setLaunching(false)
    }
  }, [goal, isRunning, launching, activeModel])

  const latest = activeEvents.length > 0 ? activeEvents[activeEvents.length - 1] : null

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

      {/* Live mode — session picker when multiple live sessions are active/available */}
      {mode === 'live' && liveSessionIds.length > 1 && (
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0, background: surface.base }}>
          <div style={{ fontSize: 10, color: fg[4], marginBottom: 4, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Active/Live Sessions
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={activeLiveSessionId}
              onChange={(e) => setSelectedLiveSessionId(e.target.value)}
              title="Select active agent session"
              style={{
                flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                borderRadius: 5, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none', minWidth: 0,
              }}
            >
              {liveSessionIds.map((id) => {
                const sessEvents = events.filter((e) => e.sessionId === id)
                const lastEv = sessEvents[sessEvents.length - 1]
                const label = lastEv?.branch ? `${lastEv.branch} (${id.slice(0, 8)})` : id.slice(0, 8)
                const isSessRunning = runningSessionIds.has(id)
                return (
                  <option key={id} value={id}>
                    {label} — {isSessRunning ? 'running' : 'finished'}
                  </option>
                )
              })}
            </select>
          </div>
        </div>
      )}

      {/* History mode — session picker over the persisted event log */}
      {mode === 'history' && (
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0, background: surface.base }}>
          <div style={{ fontSize: 10, color: fg[4], marginBottom: 4, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Past sessions
          </div>
          {historySessions.length === 0 ? (
            <div style={{ fontSize: 11, color: fg[4] }}>No recorded sessions yet.</div>
          ) : (
            <>
              {/* Gap 69 — filter by branch or session id */}
              <input
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                placeholder="Filter by branch…"
                style={{
                  width: '100%', background: surface.raised, border: `1px solid ${border[0]}`,
                  borderRadius: 5, padding: '4px 8px', fontSize: 10, color: fg[0], outline: 'none',
                  marginBottom: 6, boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <select
                  value={selectedSession}
                  onChange={(e) => setSelectedSession(e.target.value)}
                  title="Select past agent session"
                  style={{
                    flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                    borderRadius: 5, padding: '5px 8px', fontSize: 11, color: fg[0], outline: 'none', minWidth: 0,
                  }}
                >
                  {filteredSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.branch ?? s.id.slice(0, 8)} — {new Date(s.startedAt).toLocaleString()}
                    </option>
                  ))}
                </select>
                <select
                  value={replaySpeed}
                  onChange={(e) => setReplaySpeed(Number(e.target.value))}
                  title="Replay speed"
                  style={{
                    flexShrink: 0, background: surface.raised, border: `1px solid ${border[0]}`,
                    borderRadius: 5, padding: '5px 6px', fontSize: 11, color: fg[0], outline: 'none',
                  }}
                >
                  <option value={1}>1×</option>
                  <option value={5}>5×</option>
                  <option value={10}>10×</option>
                  <option value={20}>20×</option>
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
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={verifySelected}
                  title="Recompute the event log's hash chain and check for tampering"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 5,
                    background: 'transparent', border: `1px solid ${border[1]}`, color: fg[3], cursor: 'pointer',
                  }}
                >
                  <ShieldAlert size={10} /> Verify integrity
                </button>
                {selectedBranch && (
                  <button
                    type="button"
                    onClick={viewDiff}
                    title="Show the code diff this session produced"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 5,
                      background: 'transparent', border: `1px solid ${border[1]}`, color: fg[3], cursor: 'pointer',
                    }}
                  >
                    <GitBranch size={10} /> View diff
                  </button>
                )}
                <button
                  type="button"
                  onClick={exportReport}
                  title="Export this session's verification report as a standalone HTML file"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 5,
                    background: 'transparent', border: `1px solid ${border[1]}`, color: fg[3], cursor: 'pointer',
                  }}
                >
                  <Rocket size={10} /> Export HTML
                </button>
                <button
                  type="button"
                  onClick={exportReportPdf}
                  title="Export this session's verification report as PDF"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 5,
                    background: 'transparent', border: `1px solid ${border[1]}`, color: fg[3], cursor: 'pointer',
                  }}
                >
                  <Rocket size={10} /> Export PDF
                </button>
                <button
                  type="button"
                  onClick={exportComplianceJson}
                  title="Export machine-readable compliance JSON report"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 5,
                    background: 'transparent', border: `1px solid ${border[1]}`, color: fg[3], cursor: 'pointer',
                  }}
                >
                  <Rocket size={10} /> Export JSON
                </button>
                {verifyResult && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                    color: verifyResult.valid ? accent.green.fg : accent.red.fg,
                  }}>
                    {verifyResult.valid
                      ? `✓ Verified (${verifyResult.totalEvents} events)`
                      : `✗ Tampered — broken at seq ${verifyResult.brokenAtSeq}`}
                  </span>
                )}
              </div>
              {sessionDiff !== null && (
                <pre style={{
                  marginTop: 8, padding: 8, maxHeight: 200, overflow: 'auto',
                  background: surface.void, border: `1px solid ${border[1]}`, borderRadius: 5,
                  fontSize: 10, color: fg[2], whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {sessionDiff.trim() ? sessionDiff : '(no diff — branch may have been deleted or merged)'}
                </pre>
              )}
            </>
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
              {statusLabel(latest.status, latest.retryCount, latest.maxRetries)}
            </span>
            {latest.branch ? (
              <span style={{ fontSize: 9, color: fg[4], fontFamily: 'monospace' }}>{latest.branch} ({latest.sessionId.slice(0, 8)})</span>
            ) : (
              <span style={{ fontSize: 9, color: fg[4], fontFamily: 'monospace' }}>{latest.sessionId.slice(0, 8)}</span>
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
            <div style={{ paddingLeft: 17, marginTop: 6 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: `${accent.green.fg}18`,
                border: `1px solid ${accent.green.border}`,
                borderRadius: 8, padding: '6px 10px', maxWidth: '100%',
              }}>
                <span style={{ fontSize: 13 }}>🚀</span>
                <a
                  href={latest.deployUrl}
                  onClick={(e) => { e.preventDefault(); window.open(latest.deployUrl, '_blank') }}
                  style={{
                    fontSize: 10, color: accent.green.fg, fontFamily: 'monospace',
                    textDecoration: 'none', flex: 1, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  title={latest.deployUrl}
                >
                  {latest.deployUrl}
                </a>
                <button
                  type="button"
                  onClick={() => window.open(latest.deployUrl, '_blank')}
                  title="Open preview in browser"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                    background: accent.green.fg, border: 'none', color: '#000',
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <ExternalLink size={9} /> Open Preview
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(latest.deployUrl ?? '')
                    toast.success('Preview URL copied')
                  }}
                  title="Copy URL"
                  style={{
                    display: 'flex', alignItems: 'center',
                    background: 'transparent', border: `1px solid ${accent.green.border}`,
                    borderRadius: 4, padding: 3, color: accent.green.fg, cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <Copy size={9} />
                </button>
              </div>
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

      {/* Gap 86 — shadow workspace: an isolated branch the agent can write to without
          touching the working tree, reviewed via diff and explicitly promoted or discarded. */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: shadow ? 6 : 0 }}>
          <GitBranch size={11} color={accent.cyan.fg} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: fg[3], flex: 1 }}>
            Shadow Workspace
          </span>
          {!shadow && (
            <button
              type="button"
              onClick={() => void createShadow()}
              disabled={shadowBusy}
              style={{
                fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 4,
                border: `1px solid ${border[0]}`, background: surface.raised, color: fg[2],
                cursor: shadowBusy ? 'not-allowed' : 'pointer',
              }}
            >
              {shadowBusy ? 'Creating…' : 'Create'}
            </button>
          )}
        </div>
        {shadow && (
          <div>
            <div style={{ fontSize: 10, color: fg[3], fontFamily: 'monospace', marginBottom: 6 }}>
              {shadow.branch} <span style={{ color: fg[4] }}>(base: {shadow.base_ref})</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => void toggleShadowDiff()}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '4px 9px', borderRadius: 4,
                  border: `1px solid ${border[0]}`, background: surface.raised, color: fg[2],
                  cursor: 'pointer',
                }}
              >
                {shadowDiffOpen ? 'Hide Diff' : 'View Diff'}
              </button>
              <button
                type="button"
                onClick={() => void promoteShadow()}
                disabled={shadowBusy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 4,
                  background: accent.green.subtle, border: `1px solid ${accent.green.border}`,
                  color: accent.green.fg, cursor: shadowBusy ? 'not-allowed' : 'pointer',
                }}
              >
                <Check size={10} /> Promote
              </button>
              <button
                type="button"
                onClick={() => void discardShadow()}
                disabled={shadowBusy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 4,
                  background: accent.red.subtle, border: `1px solid ${accent.red.border}`,
                  color: accent.red.fg, cursor: shadowBusy ? 'not-allowed' : 'pointer',
                }}
              >
                <X size={10} /> Discard
              </button>
            </div>
            {shadowDiffOpen && shadowDiff && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Inspect Mode instructions card */}
                <div style={{
                  padding: 8,
                  borderRadius: 6,
                  background: surface.raised,
                  border: `1px solid ${border[1]}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: fg[3], textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Inspect Sandbox Branch
                  </div>
                  <div style={{ fontSize: 10, color: fg[2], lineHeight: 1.4 }}>
                    To test, run, or build this shadow workspace locally, run this command in your terminal:
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 2, alignItems: 'center' }}>
                    <code style={{
                      flex: 1,
                      background: surface.void,
                      border: `1px solid ${border[0]}`,
                      borderRadius: 4,
                      padding: '4px 6px',
                      fontSize: 10,
                      fontFamily: 'monospace',
                      color: fg[0],
                      overflowX: 'auto',
                      whiteSpace: 'nowrap'
                    }}>
                      git checkout {shadow.branch}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(`git checkout ${shadow.branch}`)
                        toast.success('Checkout command copied to clipboard')
                      }}
                      title="Copy checkout command"
                      style={{
                        background: 'transparent',
                        border: `1px solid ${border[0]}`,
                        borderRadius: 4,
                        padding: 4,
                        color: fg[3],
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                </div>

                {/* Parsed Diff Explorer */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: fg[3], textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                    Files Changed ({parsedDiff.length})
                  </div>
                  {parsedDiff.length === 0 ? (
                    <div style={{ fontSize: 10, color: fg[4], fontStyle: 'italic', padding: 4 }}>
                      (No changes detected)
                    </div>
                  ) : (
                    parsedDiff.map((file) => {
                      const isExpanded = !!expandedFiles[file.path]
                      const badgeColor = file.type === 'added' ? accent.green.fg : file.type === 'deleted' ? accent.red.fg : accent.amber.fg
                      const badgeLabel = file.type.toUpperCase()
                      
                      return (
                        <div key={file.path} style={{
                          border: `1px solid ${border[1]}`,
                          borderRadius: 6,
                          background: surface.void,
                          overflow: 'hidden'
                        }}>
                          {/* File Header */}
                          <div
                            onClick={() => setExpandedFiles(prev => ({ ...prev, [file.path]: !prev[file.path] }))}
                            style={{
                              padding: '5px 8px',
                              background: surface.raised,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 10,
                              fontFamily: 'monospace'
                            }}
                          >
                            <span style={{ color: fg[1], fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                              {file.path}
                            </span>
                            <span style={{
                              fontSize: 8,
                              fontWeight: 700,
                              padding: '1px 4px',
                              borderRadius: 3,
                              background: `${badgeColor}15`,
                              color: badgeColor,
                              border: `1px solid ${badgeColor}30`,
                              marginLeft: 6,
                              flexShrink: 0
                            }}>
                              {badgeLabel}
                            </span>
                          </div>

                          {/* File Content / Diff Lines */}
                          {isExpanded && (
                            <div style={{
                              maxHeight: 250,
                              overflowY: 'auto',
                              borderTop: `1px solid ${border[1]}`,
                              fontSize: 9.5,
                              fontFamily: 'monospace',
                              background: surface.void,
                              lineHeight: 1.4
                            }}>
                              {file.lines.map((line, idx) => {
                                let lineBg = 'transparent'
                                let lineTextColor = fg[2]
                                if (line.type === 'add') {
                                  lineBg = 'rgba(46, 160, 67, 0.12)'
                                  lineTextColor = accent.green.fg
                                } else if (line.type === 'delete') {
                                  lineBg = 'rgba(248, 81, 73, 0.12)'
                                  lineTextColor = accent.red.fg
                                } else if (line.content.startsWith('@@')) {
                                  lineBg = 'rgba(56, 139, 253, 0.08)'
                                  lineTextColor = accent.violet.fg
                                }

                                return (
                                  <div key={idx} style={{
                                    display: 'flex',
                                    background: lineBg,
                                    color: lineTextColor,
                                    borderBottom: `1px solid ${border[2]}20`
                                  }}>
                                    {/* Line Numbers Column */}
                                    <div style={{
                                      width: 25,
                                      padding: '0 4px',
                                      textAlign: 'right',
                                      color: fg[4],
                                      borderRight: `1px solid ${border[2]}50`,
                                      userSelect: 'none',
                                      flexShrink: 0
                                    }}>
                                      {line.numOld !== undefined ? line.numOld : ''}
                                    </div>
                                    <div style={{
                                      width: 25,
                                      padding: '0 4px',
                                      textAlign: 'right',
                                      color: fg[4],
                                      borderRight: `1px solid ${border[2]}50`,
                                      userSelect: 'none',
                                      flexShrink: 0
                                    }}>
                                      {line.numNew !== undefined ? line.numNew : ''}
                                    </div>
                                    {/* Code Content Column */}
                                    <pre style={{
                                      margin: 0,
                                      padding: '0 6px',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-all',
                                      fontFamily: 'inherit',
                                      flex: 1
                                    }}>
                                      {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}{line.content}
                                    </pre>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
            {activeEvents.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: fg[4], fontSize: 11 }}>
                No agent activity yet. Start an autonomous run from the Task Planner panel.
              </div>
            )}
            {activeEvents.map((e, i) => <EventRow key={i} e={e} />)}
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
