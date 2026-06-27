import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, Play, Square, AlertTriangle, Sparkles, Trash2, Bot, Loader } from 'lucide-react'
import { toast } from '../../store/useToastStore'
import { useChatStore } from '../../store/useChatStore'
import { useAppStore } from '../../store/useAppStore'
import { PanelHeader, accent, border, fg, surface } from '../../design'

interface AlertRecord {
  id: string
  ts: number
  line: string
  monitorId: string
}

const COMMAND_PLACEHOLDERS = [
  'vercel logs <deployment-url> --follow',
  'netlify logs:function',
  'docker compose logs -f',
  'pm2 logs',
]

const MAX_LOG_LINES = 1000
const ALERT_WINDOW_MS = 60_000
const ALERT_THRESHOLD = 3

export function MonitorPanel() {
  const [command, setCommand] = useState('')
  const [monitorId, setMonitorId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [alertsOpen, setAlertsOpen] = useState(true)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnosis, setDiagnosis] = useState<string | null>(null)

  const activeModel = useChatStore((s) => s.activeModel)
  const setActiveActivity = useAppStore((s) => s.setActiveActivity)
  const [fixing, setFixing] = useState(false)

  const autoFixWithAi = useCallback(async (recentAlerts: AlertRecord[]) => {
    if (fixing || recentAlerts.length === 0) return
    setFixing(true)
    try {
      const errorText = recentAlerts.slice(0, 5).map((a) => a.line).join('\n')
      const goalText = `Fix the following runtime crash or error detected in logs:\n\n${errorText}\n\nInvestigate relevant files, make the fix, run unit tests to verify, and prompt the developer when done.`
      
      const detail = await window.api.taskPlanner.create(goalText)
      if (!detail?.slug) {
        toast.error('Failed to create self-healing task plan')
        return
      }
      
      const plans = await window.api.taskPlanner.list()
      const summary = plans.find((p) => p.slug === detail.slug)
      if (!summary?.path) {
        toast.error('Could not locate plan file')
        return
      }
      
      const sessionId = await window.api.agent.startAutonomous({ planFile: summary.path, model: activeModel })
      if (sessionId) {
        toast.success('Self-healing background agent started')
        setActiveActivity('agent')
      } else {
        toast.error('Failed to start self-healing agent session')
      }
    } catch (err) {
      toast.error(`Auto-fix initiation failed: ${(err as Error).message}`)
    } finally {
      setFixing(false)
    }
  }, [activeModel, fixing, setActiveActivity])

  const logRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)
  const autoTriggeredRef = useRef(false)
  const partialLineRef = useRef('')

  useEffect(() => {
    window.api.monitor.listAlerts().then(setAlerts).catch(() => {})
  }, [])

  // Deploy → Monitor handoff (GitPanel's "Watch Logs" button) — prefills the
  // command for the user to review/edit, doesn't auto-start it, consistent
  // with the human-confirms-before-running pattern used throughout this app.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ command: string }>).detail
      if (detail?.command) setCommand(detail.command)
    }
    window.addEventListener('meshflow:monitor:prefill', handler)
    return () => window.removeEventListener('meshflow:monitor:prefill', handler)
  }, [])

  const diagnoseWithAi = useCallback(async (recentAlerts: AlertRecord[]) => {
    if (diagnosing || recentAlerts.length === 0) return
    setDiagnosing(true)
    setDiagnosis(null)
    try {
      const lines = recentAlerts.slice(0, 20).map((a) => a.line).join('\n')
      const streamId = await window.api.ai.streamChat({
        messages: [{ role: 'user', content: `These log lines were flagged as errors:\n\n${lines}` }],
        model: activeModel,
        systemPrompt: 'You are a senior SRE. Given log lines flagged as errors, give a concise root-cause hypothesis and a concrete next diagnostic step. Plain text, no markdown fences, under 150 words.',
      })
      let text = ''
      await new Promise<void>((resolve, reject) => {
        const unChunk = window.api.ai.onChunk(streamId, (d) => { text += d })
        const unDone = window.api.ai.onDone(streamId, () => { unChunk(); unDone(); unErr(); resolve() })
        const unErr = window.api.ai.onError(streamId, (e) => { unChunk(); unDone(); unErr(); reject(new Error(e)) })
      })
      setDiagnosis(text.trim())
    } catch (err) {
      toast.error(`Diagnose failed: ${(err as Error).message}`)
    } finally {
      setDiagnosing(false)
    }
  }, [activeModel, diagnosing])

  useEffect(() => {
    if (!monitorId) return
    let cancelled = false
    // Race fix — a near-instant command (e.g. `echo`) can spawn, run, and
    // exit before this effect even runs (it only fires after monitor:start's
    // IPC round-trip resolves and triggers the re-render that sets
    // monitorId), so the onData subscription below can miss everything.
    // consumedLength is advanced by every appendChunk call — live or the
    // backlog catch-up below — so whichever data already arrived live isn't
    // double-counted when the backlog fetch resolves afterward.
    let consumedLength = 0

    const appendChunk = (data: string) => {
      consumedLength += data.length
      const combined = partialLineRef.current + data
      const parts = combined.split('\n')
      partialLineRef.current = parts.pop() ?? ''
      if (parts.length === 0) return
      setLogLines((prev) => {
        const next = [...prev, ...parts]
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
      })
    }

    const offData = window.api.monitor.onData(monitorId, appendChunk)

    const offAlert = window.api.monitor.onAlert(monitorId, (alert) => {
      setAlerts((prev) => {
        const next = [alert, ...prev]
        const recent = next.filter((a) => Date.now() - a.ts < ALERT_WINDOW_MS)
        if (!autoTriggeredRef.current && recent.length >= ALERT_THRESHOLD) {
          autoTriggeredRef.current = true
          void diagnoseWithAi(recent)
        }
        return next
      })
    })

    const offExit = window.api.monitor.onExit(monitorId, () => {
      setMonitorId(null)
      toast.info('Monitor command exited')
    })

    window.api.monitor.getBacklog(monitorId).then((backlog) => {
      if (cancelled || !backlog) return
      const missed = backlog.slice(consumedLength)
      if (missed) appendChunk(missed)
    }).catch(() => {})

    return () => { cancelled = true; offData(); offAlert(); offExit() }
  }, [monitorId, diagnoseWithAi])

  useEffect(() => {
    if (!pinnedToBottom.current || !logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  const handleScroll = () => {
    const el = logRef.current
    if (!el) return
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const start = async () => {
    if (!command.trim() || starting) return
    setStarting(true)
    try {
      const result = await window.api.monitor.start(command.trim())
      if (result.error || !result.id) {
        toast.error(result.error ?? 'Failed to start monitor')
        return
      }
      setLogLines([])
      partialLineRef.current = ''
      autoTriggeredRef.current = false
      setDiagnosis(null)
      setMonitorId(result.id)
    } finally {
      setStarting(false)
    }
  }

  const stop = async () => {
    if (!monitorId) return
    await window.api.monitor.stop(monitorId)
    setMonitorId(null)
  }

  const clearAlerts = async () => {
    await window.api.monitor.clearAlerts()
    setAlerts([])
    setDiagnosis(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PanelHeader icon={<Activity style={{ width: 13, height: 13, color: accent.red.fg }} />} label="Monitor" />

      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void start() }}
          disabled={!!monitorId}
          placeholder={COMMAND_PLACEHOLDERS[0]}
          style={{
            width: '100%', boxSizing: 'border-box', fontSize: 11, fontFamily: 'monospace',
            padding: '6px 8px', borderRadius: 4, border: `1px solid ${border[0]}`,
            background: surface.raised, color: fg[0],
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {monitorId ? (
            <button
              type="button"
              onClick={() => void stop()}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
                padding: '5px 10px', borderRadius: 4, border: `1px solid ${accent.red.border}`,
                background: accent.red.subtle, color: accent.red.fg, cursor: 'pointer',
              }}
            >
              <Square size={11} /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              disabled={starting || !command.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
                padding: '5px 10px', borderRadius: 4, border: `1px solid ${accent.green.border}`,
                background: accent.green.subtle, color: accent.green.fg,
                cursor: starting || !command.trim() ? 'not-allowed' : 'pointer',
                opacity: starting || !command.trim() ? 0.5 : 1,
              }}
            >
              <Play size={11} /> {starting ? 'Starting…' : 'Start'}
            </button>
          )}
        </div>
      </div>

      <div
        ref={logRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflowY: 'auto', padding: '8px 10px', fontFamily: 'monospace',
          fontSize: 10.5, lineHeight: 1.5, color: fg[1], whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}
      >
        {logLines.length === 0 ? (
          <div style={{ color: fg[3] }}>
            No output yet. Start a log command above to tail it live.
          </div>
        ) : (
          logLines.map((line, i) => (
            <div key={i} style={{ color: /\b(error|exception|fail(?:ed|ure)?|fatal|panic|5\d\d)\b/i.test(line) ? accent.red.fg : fg[1] }}>
              {line}
            </div>
          ))
        )}
      </div>

      <div style={{ flexShrink: 0, borderTop: `1px solid ${border[1]}`, maxHeight: '45%', overflowY: 'auto' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', cursor: 'pointer',
          }}
          onClick={() => setAlertsOpen((o) => !o)}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: accent.red.fg }}>
            <AlertTriangle size={11} /> Alerts ({alerts.length})
          </span>
          {alerts.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void clearAlerts() }}
              title="Clear alerts"
              style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', color: fg[3], cursor: 'pointer', padding: 2 }}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>

        {alertsOpen && alerts.length > 0 && (
          <div style={{ padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => void diagnoseWithAi(alerts)}
                disabled={diagnosing || fixing}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700,
                  padding: '5px 9px', borderRadius: 4, border: `1px solid ${accent.violet.border}`,
                  background: accent.violet.subtle, color: accent.violet.fg,
                  cursor: diagnosing || fixing ? 'not-allowed' : 'pointer',
                }}
              >
                <Sparkles size={11} /> {diagnosing ? 'Diagnosing…' : 'Diagnose with AI'}
              </button>

              <button
                type="button"
                onClick={() => void autoFixWithAi(alerts)}
                disabled={diagnosing || fixing}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700,
                  padding: '5px 9px', borderRadius: 4, border: `1px solid ${accent.green.border}`,
                  background: accent.green.subtle, color: accent.green.fg,
                  cursor: diagnosing || fixing ? 'not-allowed' : 'pointer',
                }}
              >
                {fixing ? <Loader size={11} className="agent-pulse" /> : <Bot size={11} />}
                {fixing ? 'Starting Repair…' : 'Auto-Fix with AI Agent'}
              </button>
            </div>

            {diagnosis && (
              <div style={{ fontSize: 10.5, color: fg[1], background: surface.raised, borderRadius: 4, padding: '6px 8px', lineHeight: 1.5 }}>
                {diagnosis}
              </div>
            )}

            {alerts.slice(0, 30).map((a) => (
              <div key={a.id} style={{ fontSize: 10, fontFamily: 'monospace', color: accent.red.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {new Date(a.ts).toLocaleTimeString()} — {a.line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
