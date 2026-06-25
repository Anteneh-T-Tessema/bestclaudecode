import { useAppStore } from '../store/useAppStore'
import { surface, border, fg } from '../design'
import { FileExplorer } from '../components/sidebar/FileExplorer'
import { GitPanel } from '../components/sidebar/GitPanel'
import { SearchPanel } from '../components/sidebar/SearchPanel'
import { CodeSearchPanel } from '../components/sidebar/CodeSearchPanel'
import { MemoryPanel } from '../components/sidebar/MemoryPanel'
import { TaskPlannerPanel } from '../components/sidebar/TaskPlannerPanel'
import { AuditTrailPanel } from '../components/audit/AuditTrailPanel'
import { ArchDocPanel } from '../components/sidebar/ArchDocPanel'
import { AgentProgressPanel } from '../components/agent/AgentProgressPanel'
import { DebugPanel } from '../components/sidebar/DebugPanel'
import { OutlinePanel } from '../components/sidebar/OutlinePanel'
import { NotepadsPanel } from '../components/sidebar/NotepadsPanel'
import { SettingsPanel } from '../components/settings/SettingsPanel'
import { UsageDashboardPanel } from '../components/sidebar/UsageDashboardPanel'
import { CodebaseMapPanel } from '../components/sidebar/CodebaseMapPanel'
import { GitHubPanel } from '../components/sidebar/GitHubPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'

const LABELS: Record<string, string> = {
  files: 'EXPLORER',
  git: 'SOURCE CONTROL',
  search: 'SEARCH',
  codesearch: 'CODE SEARCH',
  memory: 'MEMORY',
  tasks: 'TASK PLANNER',
  chat: 'AI CHAT',
  audit: 'AUDIT TRAIL',
  archdoc: 'ARCHITECTURE',
  agent: 'AGENT',
  debug: 'DEBUG',
  outline: 'OUTLINE',
  notepads: 'NOTEPADS',
  usage: 'USAGE DASHBOARD',
  map: 'CODEBASE MAP',
  github: 'GITHUB',
  settings: 'SETTINGS',
}

export function Sidebar() {
  const activeActivity = useAppStore((s) => s.activeActivity)

  const renderPanel = () => {
    switch (activeActivity) {
      case 'files':
        return <FileExplorer />
      case 'git':
        return <GitPanel />
      case 'search':
        return <SearchPanel />
      case 'codesearch':
        return <CodeSearchPanel />
      case 'memory':
        return <MemoryPanel />
      case 'tasks':
        return <TaskPlannerPanel />
      case 'chat':
        // Chat is rendered in the right panel; sidebar shows a hint
        return (
          <div style={{ padding: 16, color: fg[2], fontSize: 12 }}>
            Chat is open in the right panel.
          </div>
        )
      case 'audit':
        return <AuditTrailPanel />
      case 'archdoc':
        return <ArchDocPanel />
      case 'agent':
        return <AgentProgressPanel />
      case 'debug':
        return <DebugPanel />
      case 'outline':
        return <OutlinePanel />
      case 'notepads':
        return <NotepadsPanel />
      case 'usage':
        return <UsageDashboardPanel />
      case 'map':
        return <CodebaseMapPanel />
      case 'github':
        return <GitHubPanel />
      case 'settings':
        return <SettingsPanel />
      default:
        return null
    }
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: surface.surface,
        overflow: 'hidden',
      }}
    >
      {/* Section header */}
      <div
        style={{
          height: 35,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          borderBottom: `1px solid ${border[1]}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: fg[2],
            userSelect: 'none',
          }}
        >
          {LABELS[activeActivity] ?? ''}
        </span>
      </div>

      {/* Panel content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ErrorBoundary>
          {renderPanel()}
        </ErrorBoundary>
      </div>
    </div>
  )
}
