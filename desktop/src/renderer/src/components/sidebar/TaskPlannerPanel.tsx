import { useState, useEffect, useCallback } from 'react'
import { ListTodo, Plus, ChevronRight, CheckCircle2, Circle, RefreshCw, Play, Square, Trash2 } from 'lucide-react'
import { EmptyState } from '../EmptyState'
import { toast } from '../../store/useToastStore'
import { useChatStore } from '../../store/useChatStore'
import { PanelHeader, IconButton, accent, border, fg, surface } from '../../design'

interface PlanSummary {
  slug: string
  goal: string
  done: number
  total: number
  path: string
}

interface Subtask {
  id: string
  description: string
  depends_on: string[]
  done: boolean
  role?: string
}

interface TaskPlanDetail {
  goal: string
  slug: string
  subtasks: Subtask[]
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0
  return (
    <div style={{ height: 4, background: surface.raised, borderRadius: 2, overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          background: pct === 100 ? accent.green.fg : accent.amber.fg,
          transition: 'width 0.2s',
        }}
      />
    </div>
  )
}

function PlanRow({
  summary,
  expanded,
  detail,
  onToggle,
  onMarkDone,
  onStartAutonomous,
  onStopAutonomous,
  onDelete,
  isRunning,
}: {
  summary: PlanSummary
  expanded: boolean
  detail: TaskPlanDetail | null
  onToggle: () => void
  onMarkDone: (id: string) => void
  onStartAutonomous: () => void
  onStopAutonomous: () => void
  onDelete: () => void
  isRunning: boolean
}) {
  return (
    <div style={{ borderBottom: `1px solid ${border[2]}` }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
        }}
      >
        <ChevronRight
          size={12}
          color={fg[3]}
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: fg[1], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary.goal}
          </div>
          <div style={{ marginTop: 3 }}>
            <ProgressBar done={summary.done} total={summary.total} />
          </div>
        </div>
        <span style={{ fontSize: 9, color: fg[4], flexShrink: 0, marginRight: 2 }}>
          {summary.done}/{summary.total}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            isRunning ? onStopAutonomous() : onStartAutonomous()
          }}
          title={isRunning ? 'Stop autonomous agent' : 'Run autonomous agent'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, borderRadius: 4, border: 'none', flexShrink: 0,
            background: isRunning ? accent.red.subtle : accent.amber.subtle,
            color: isRunning ? accent.red.fg : accent.amber.fg,
            cursor: 'pointer',
          }}
        >
          {isRunning ? <Square size={9} /> : <Play size={9} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete plan"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, borderRadius: 4, border: 'none', flexShrink: 0,
            background: 'transparent', color: fg[4], cursor: 'pointer',
          }}
        >
          <Trash2 size={9} />
        </button>
      </div>
      {expanded && detail && (
        <div style={{ paddingBottom: 6 }}>
          {detail.subtasks.map((s) => (
            <div
              key={s.id}
              onClick={() => !s.done && onMarkDone(s.id)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '4px 12px 4px 30px',
                cursor: s.done ? 'default' : 'pointer',
              }}
            >
              {s.done ? (
                <CheckCircle2 size={12} color={accent.green.fg} style={{ flexShrink: 0, marginTop: 1 }} />
              ) : (
                <Circle size={12} color={fg[4]} style={{ flexShrink: 0, marginTop: 1 }} />
              )}
              <span
                style={{
                  fontSize: 11,
                  color: s.done ? fg[3] : fg[1],
                  textDecoration: s.done ? 'line-through' : 'none',
                  lineHeight: 1.4,
                }}
              >
                [{s.id}] {s.description}
                {s.role && (
                  <span style={{
                    marginLeft: 4, fontSize: 8, fontWeight: 700, letterSpacing: '0.05em',
                    color: s.role === 'security' ? accent.violet.fg : s.role === 'frontend' ? accent.cyan.fg : s.role === 'test' ? accent.green.fg : s.role === 'docs' ? fg[3] : accent.amber.fg,
                    textTransform: 'uppercase',
                  }}>{s.role}</span>
                )}
                {s.depends_on.length > 0 && (
                  <span style={{ color: fg[4], fontSize: 9 }}> (after: {s.depends_on.join(', ')})</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TaskPlannerPanel() {
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [details, setDetails] = useState<Record<string, TaskPlanDetail>>({})
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [newGoal, setNewGoal] = useState('')
  const [creating, setCreating] = useState(false)
  const [activeSessionsByPlanFile, setActiveSessionsByPlanFile] = useState<Map<string, string>>(new Map())

  const activeModel = useChatStore((s) => s.activeModel)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setPlans(await window.api.taskPlanner.list())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggleExpand = async (summary: PlanSummary) => {
    if (expandedPath === summary.path) {
      setExpandedPath(null)
      return
    }
    setExpandedPath(summary.path)
    if (!details[summary.path]) {
      const detail = await window.api.taskPlanner.show(summary.path)
      if (detail) {
        setDetails((d) => ({ ...d, [summary.path]: detail }))
      }
    }
  }

  const markDone = async (summary: PlanSummary, subtaskId: string) => {
    const result = await window.api.taskPlanner.markDone(summary.path, subtaskId)
    if (!result) return
    const detail = await window.api.taskPlanner.show(summary.path)
    if (detail) setDetails((d) => ({ ...d, [summary.path]: detail }))
    setPlans((ps) => ps.map((p) => (p.path === summary.path ? { ...p, done: result.done, total: result.total } : p)))
  }

  const createPlan = async () => {
    if (!newGoal.trim()) return
    setCreating(true)
    try {
      const detail = await window.api.taskPlanner.create(newGoal.trim())
      if (detail) {
        toast.success('Plan created')
        setNewGoal('')
        await refresh()
      } else {
        toast.error('Failed to create plan')
      }
    } finally {
      setCreating(false)
    }
  }

  const deletePlan = async (summary: PlanSummary) => {
    const result = await window.api.taskPlanner.delete(summary.path)
    if (result?.deleted) {
      if (expandedPath === summary.path) setExpandedPath(null)
      setDetails((d) => { const next = { ...d }; delete next[summary.path]; return next })
      setPlans((ps) => ps.filter((p) => p.path !== summary.path))
    } else {
      toast.error('Failed to delete plan')
    }
  }

  const startAutonomous = async (planFile: string) => {
    const model = activeModel ?? 'claude-sonnet-4-6'
    const sessionId = await window.api.agent.startAutonomous({ planFile, model })
    if (sessionId) {
      setActiveSessionsByPlanFile((prev) => new Map([...prev, [planFile, sessionId]]))
      toast.success('Autonomous agent started')
    } else {
      toast.error('Failed to start autonomous agent')
    }
  }

  const stopAutonomous = async (planFile: string) => {
    const sessionId = activeSessionsByPlanFile.get(planFile)
    if (sessionId) await window.api.agent.stopAutonomous(sessionId)
    setActiveSessionsByPlanFile((prev) => { const m = new Map(prev); m.delete(planFile); return m })
    toast.success('Autonomous agent stopped')
  }

  useEffect(() => {
    const off = window.api.agent.onProgress((raw: unknown) => {
      const p = raw as { planFile: string; status: string; doneCount: number; totalCount: number; subtaskDescription?: string; error?: string }
      if (p.status === 'done') {
        setPlans((prev) => prev.map((pl) =>
          pl.path === p.planFile ? { ...pl, done: p.doneCount, total: p.totalCount } : pl
        ))
      }
      if (p.status === 'finished') {
        setActiveSessionsByPlanFile((prev) => { const m = new Map(prev); m.delete(p.planFile); return m })
        toast.success('Agent finished all subtasks')
        refresh()
      }
      if (p.status === 'blocked') {
        setActiveSessionsByPlanFile((prev) => { const m = new Map(prev); m.delete(p.planFile); return m })
        toast.error(`Agent blocked: ${p.error ?? 'unknown error'}`)
      }
      if (p.status === 'error') {
        setActiveSessionsByPlanFile((prev) => { const m = new Map(prev); m.delete(p.planFile); return m })
        toast.error(`Agent error: ${p.error ?? 'unknown error'}`)
      }
    })
    return off
  }, [refresh])

  const headerActions = (
    <IconButton size={22} onClick={refresh} disabled={loading} title="Refresh">
      <RefreshCw style={{ width: 11, height: 11 }} className={loading ? 'agent-pulse' : ''} />
    </IconButton>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<ListTodo style={{ width: 13, height: 13, color: accent.amber.fg }} />}
        label="Task Planner"
        actions={headerActions}
      />

      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0, display: 'flex', gap: 6 }}>
        <input
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createPlan()
          }}
          placeholder="New long-horizon goal…"
          disabled={creating}
          style={{
            flex: 1,
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 4,
            outline: 'none',
            fontSize: 11,
            color: fg[0],
            padding: '6px 8px',
          }}
        />
        <button
          type="button"
          onClick={createPlan}
          disabled={creating || !newGoal.trim()}
          title="Create plan"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            borderRadius: 4,
            border: 'none',
            background: newGoal.trim() ? accent.amber.fg : surface.raised,
            color: newGoal.trim() ? surface.void : fg[3],
            cursor: newGoal.trim() ? 'pointer' : 'default',
          }}
        >
          <Plus size={13} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!loading && plans.length === 0 && (
          <EmptyState
            icon={<ListTodo size={20} />}
            title="No plans yet"
            description="Long-horizon goals get decomposed into dependency-ordered subtasks here — the same mechanism /plan-implement uses to execute multi-hour work without intervention."
          />
        )}
        {plans.map((summary) => (
          <PlanRow
            key={summary.path}
            summary={summary}
            expanded={expandedPath === summary.path}
            detail={details[summary.path] ?? null}
            onToggle={() => toggleExpand(summary)}
            onMarkDone={(id) => markDone(summary, id)}
            onStartAutonomous={() => startAutonomous(summary.path)}
            onStopAutonomous={() => stopAutonomous(summary.path)}
            onDelete={() => deletePlan(summary)}
            isRunning={activeSessionsByPlanFile.has(summary.path)}
          />
        ))}
      </div>
    </div>
  )
}
