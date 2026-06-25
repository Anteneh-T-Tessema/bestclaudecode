import { useEffect, useState, useCallback } from 'react'
import { Square, StopCircle, GitMerge, Share2 } from 'lucide-react'
import { accent, border, fg, surface } from '../../design'
import { toast } from '../../store/useToastStore'

const TERMINAL_STATUSES = ['finished', 'blocked', 'error', 'pr-opened', 'push-failed-kept-locally', 'deployed', 'approval-rejected']

interface SessionCard {
  sessionId: string
  latestStatus: string
  latestDescription: string
  role?: string
  branch?: string
  isFinished: boolean
}

const ROLE_COLOR: Record<string, string> = {
  frontend: accent.cyan.fg,
  backend: accent.amber.fg,
  security: accent.violet.fg,
  test: accent.green.fg,
  docs: fg[3],
}

export function SwarmPanel() {
  const [sessions, setSessions] = useState<SessionCard[]>([])

  const refresh = useCallback(async () => {
    const ids = await window.api.agent.getActiveSessions()
    setSessions((prev) => {
      const existing = new Map(prev.map((s) => [s.sessionId, s]))
      const active = ids.map((id) => existing.get(id) ?? { sessionId: id, latestStatus: 'running', latestDescription: '', role: undefined, branch: undefined, isFinished: false })
      // Keep finished sessions that are already in state
      const finished = prev.filter((s) => s.isFinished && !ids.includes(s.sessionId))
      return [...active, ...finished]
    })
  }, [])

  useEffect(() => {
    refresh()
    const off = window.api.agent.onProgress((raw: unknown) => {
      const p = raw as { sessionId: string; status: string; subtaskDescription?: string; role?: string; branch?: string }
      const isTerminal = TERMINAL_STATUSES.includes(p.status)
      setSessions((prev) => {
        const exists = prev.find((s) => s.sessionId === p.sessionId)
        if (exists) {
          return prev.map((s) => s.sessionId === p.sessionId
            ? { ...s, latestStatus: p.status, latestDescription: p.subtaskDescription ?? s.latestDescription, role: p.role ?? s.role, branch: p.branch ?? s.branch, isFinished: isTerminal }
            : s)
        }
        return [...prev, { sessionId: p.sessionId, latestStatus: p.status, latestDescription: p.subtaskDescription ?? '', role: p.role, branch: p.branch, isFinished: isTerminal }]
      })
    })
    return off
  }, [refresh])

  const stopSession = useCallback(async (sessionId: string) => {
    const ok = await window.api.agent.stopAutonomous(sessionId)
    if (ok) { toast.success(`Stopped session ${sessionId.slice(0, 8)}`); setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId)) }
    else toast.error('Failed to stop session')
  }, [])

  const stopAll = useCallback(async () => {
    for (const s of sessions.filter((s) => !s.isFinished)) { await window.api.agent.stopAutonomous(s.sessionId) }
    setSessions((prev) => prev.filter((s) => s.isFinished))
    toast.success('All active sessions stopped')
  }, [sessions])

  const mergeSession = useCallback(async (s: SessionCard) => {
    if (!s.branch) { toast.error('No branch information — cannot merge'); return }
    const result = await window.api.agent.mergeSession(s.branch)
    if (result.success) {
      toast.success(`Merged ${s.branch} cleanly`)
    } else if (result.conflicts.length > 0) {
      toast.error(`Merge conflicts in: ${result.conflicts.slice(0, 3).join(', ')}${result.conflicts.length > 3 ? '…' : ''}`)
    } else {
      toast.error(result.error ?? 'Merge failed')
    }
  }, [])

  const shareSession = useCallback(async (sessionId: string) => {
    try {
      const link = await window.api.collab.getInviteLink(sessionId)
      if (!link) { toast.error('Failed to create invite link'); return }
      await navigator.clipboard.writeText(link)
      toast.success('Invite link copied — anyone with this link can watch and approve this session')
    } catch {
      toast.error('Failed to create invite link')
    }
  }, [])

  const activeSessions = sessions.filter((s) => !s.isFinished)
  const finishedSessions = sessions.filter((s) => s.isFinished)

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: fg[3] }}>
          Active ({activeSessions.length})
        </span>
        {activeSessions.length > 0 && (
          <button
            type="button"
            onClick={stopAll}
            title="Stop all running sessions"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '3px 8px',
              borderRadius: 4, background: 'transparent', border: `1px solid ${border[1]}`, color: accent.red.fg, cursor: 'pointer',
            }}
          >
            <StopCircle size={10} /> Stop All
          </button>
        )}
      </div>

      {activeSessions.length === 0 && finishedSessions.length === 0 && (
        <div style={{ fontSize: 11, color: fg[3], textAlign: 'center', marginTop: 24 }}>
          No active sessions. Start an agent from the Task Planner.
        </div>
      )}

      {sessions.map((s) => (
        <div key={s.sessionId} style={{
          background: surface.raised, border: `1px solid ${s.isFinished ? border[0] : border[1]}`, borderRadius: 6, padding: '8px 10px',
          display: 'flex', flexDirection: 'column', gap: 4,
          opacity: s.isFinished ? 0.75 : 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: fg[0], fontFamily: 'monospace', letterSpacing: '-0.01em' }}>
              {s.sessionId.slice(0, 8)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {s.role && (
                <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ROLE_COLOR[s.role] ?? accent.amber.fg }}>
                  {s.role}
                </span>
              )}
              <span style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                color: s.latestStatus === 'blocked' ? accent.red.fg : s.latestStatus === 'pending-approval' ? accent.amber.fg : s.isFinished ? fg[2] : accent.green.fg,
              }}>
                {s.latestStatus}
              </span>
              <button
                type="button"
                onClick={() => void shareSession(s.sessionId)}
                title="Copy a live-view link for this session"
                style={{
                  display: 'flex', alignItems: 'center', padding: 3, borderRadius: 3,
                  background: 'transparent', border: 'none', color: fg[3], cursor: 'pointer',
                }}
              >
                <Share2 size={10} />
              </button>
              {s.isFinished && s.branch ? (
                <button
                  type="button"
                  onClick={() => mergeSession(s)}
                  title={`Merge branch ${s.branch}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 3, fontSize: 9,
                    background: 'transparent', border: `1px solid ${border[1]}`, color: accent.green.fg, cursor: 'pointer',
                  }}
                >
                  <GitMerge size={9} /> Merge
                </button>
              ) : !s.isFinished ? (
                <button
                  type="button"
                  onClick={() => stopSession(s.sessionId)}
                  title={`Stop session ${s.sessionId.slice(0, 8)}`}
                  style={{
                    display: 'flex', alignItems: 'center', padding: 3, borderRadius: 3,
                    background: 'transparent', border: 'none', color: fg[3], cursor: 'pointer',
                  }}
                >
                  <Square size={10} />
                </button>
              ) : null}
            </div>
          </div>
          {s.latestDescription && (
            <div style={{ fontSize: 10, color: fg[2], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.latestDescription}
            </div>
          )}
          {s.branch && (
            <div style={{ fontSize: 9, color: fg[3], fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.branch}
            </div>
          )}
        </div>
      ))}

      {finishedSessions.length > 0 && (
        <button
          type="button"
          onClick={() => setSessions((prev) => prev.filter((s) => !s.isFinished))}
          style={{
            marginTop: 4, fontSize: 10, color: fg[3], background: 'transparent', border: 'none',
            cursor: 'pointer', textDecoration: 'underline', textAlign: 'left', padding: 0,
          }}
        >
          Clear {finishedSessions.length} finished session{finishedSessions.length > 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}
