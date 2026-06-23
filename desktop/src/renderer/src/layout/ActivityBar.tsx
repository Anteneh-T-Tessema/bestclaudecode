import { useEffect, useState } from 'react'
import { Files, GitBranch, Search, MessageSquare, ShieldCheck, Settings, Brain, Radar, ListTodo, BookOpen, Bot, Bug, ListTree, StickyNote } from 'lucide-react'
import { useAppStore, type ActivityId } from '../store/useAppStore'
import { IconButton, Tooltip, accent, surface, border, type AccentName } from '../design'

interface ActivityDef {
  id: ActivityId
  icon: React.FC<{ style?: React.CSSProperties }>
  label: string
  accentName?: AccentName
}

const ACTIVITIES: ActivityDef[] = [
  { id: 'files', icon: Files, label: 'Explorer', accentName: 'blue' },
  { id: 'git', icon: GitBranch, label: 'Source Control', accentName: 'amber' },
  { id: 'search', icon: Search, label: 'Find in Files', accentName: 'cyan' },
  { id: 'codesearch', icon: Radar, label: 'Code Search', accentName: 'cyan' },
  { id: 'memory', icon: Brain, label: 'Memory', accentName: 'violet' },
  { id: 'tasks', icon: ListTodo, label: 'Task Planner', accentName: 'amber' },
  { id: 'chat', icon: MessageSquare, label: 'AI Chat', accentName: 'violet' },
  { id: 'audit', icon: ShieldCheck, label: 'Audit Trail', accentName: 'green' },
  { id: 'archdoc', icon: BookOpen, label: 'Architecture Doc', accentName: 'blue' },
  { id: 'agent', icon: Bot, label: 'Agent Progress', accentName: 'violet' },
  { id: 'debug', icon: Bug, label: 'Debug', accentName: 'red' },
  { id: 'outline', icon: ListTree, label: 'Outline', accentName: 'cyan' },
  { id: 'notepads', icon: StickyNote, label: 'Notepads', accentName: 'amber' },
]

const BOTTOM: ActivityDef = { id: 'settings', icon: Settings, label: 'Settings' }

function ActivityButton({
  activity,
  isActive,
  onClick,
}: {
  activity: ActivityDef
  isActive: boolean
  onClick: () => void
}) {
  const { icon: Icon, label, accentName } = activity
  const activeColor = accentName ? accent[accentName].fg : undefined

  return (
    <Tooltip label={label} side="right">
      <div style={{ position: 'relative' }}>
        {isActive && accentName && (
          <div
            style={{
              position: 'absolute',
              left: -8,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 2.5,
              height: 16,
              background: accent[accentName].fg,
              borderRadius: '0 2px 2px 0',
              boxShadow: `0 0 8px ${accent[accentName].fg}`,
            }}
          />
        )}
        <IconButton
          size={36}
          active={isActive}
          activeColor={activeColor}
          data-testid={`activity-${activity.id}`}
          aria-label={label}
          onClick={onClick}
        >
          <Icon style={{ width: 17, height: 17 }} />
        </IconButton>
      </div>
    </Tooltip>
  )
}

export function ActivityBar() {
  const { activeActivity, setActiveActivity } = useAppStore()
  const [agentRunning, setAgentRunning] = useState(false)

  useEffect(() => {
    window.api.agent.getActiveSession().then((id) => setAgentRunning(!!id))
    const off = window.api.agent.onProgress((raw: unknown) => {
      const p = raw as { status: string }
      if (p.status === 'running' || p.status === 'retrying') setAgentRunning(true)
      if (p.status === 'finished' || p.status === 'blocked' || p.status === 'error') setAgentRunning(false)
    })
    return off
  }, [])

  return (
    <div
      style={{
        width: 48,
        height: '100%',
        background: surface.void,
        borderRight: `1px solid ${border[2]}`,
        paddingTop: 8,
        paddingBottom: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        gap: 6,
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {ACTIVITIES.map((activity) => (
          <div key={activity.id} style={{ position: 'relative' }}>
            <ActivityButton
              activity={activity}
              isActive={activeActivity === activity.id}
              onClick={() => setActiveActivity(activity.id)}
            />
            {activity.id === 'agent' && agentRunning && (
              <span style={{
                position: 'absolute', top: 4, right: 4,
                width: 7, height: 7, borderRadius: '50%',
                background: accent.amber.fg,
                boxShadow: `0 0 6px ${accent.amber.fg}`,
                animation: 'pulse 1.2s ease-in-out infinite',
                pointerEvents: 'none',
              }} />
            )}
          </div>
        ))}
      </div>

      <ActivityButton
        activity={BOTTOM}
        isActive={activeActivity === BOTTOM.id}
        onClick={() => setActiveActivity(BOTTOM.id)}
      />
    </div>
  )
}
