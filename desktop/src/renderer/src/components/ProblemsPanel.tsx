import { AlertCircle, AlertTriangle, Info, CheckCircle2, type LucideIcon } from 'lucide-react'
import { useProblemsStore, type Problem, type ProblemSeverity } from '../store/useProblemsStore'
import { useEditorStore } from '../store/useEditorStore'
import { EmptyState } from './EmptyState'
import { accent, fg, border } from '../design'

const SEVERITY_ICON: Record<ProblemSeverity, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  hint: Info,
}

const SEVERITY_COLOR: Record<ProblemSeverity, string> = {
  error: accent.red.fg,
  warning: accent.amber.fg,
  info: accent.cyan.fg,
  hint: fg[3],
}

function ProblemRow({ problem }: { problem: Problem }) {
  const openFile = useEditorStore((s) => s.openFile)
  const Icon = SEVERITY_ICON[problem.severity]
  const color = SEVERITY_COLOR[problem.severity]

  const handleClick = async () => {
    try {
      const content = await window.api.fs.readFile(problem.filePath)
      openFile(problem.filePath, content)
    } catch {
      // file may have moved; ignore
    }
  }

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '5px 14px',
        cursor: 'pointer',
        borderBottom: `1px solid ${border[2]}`,
      }}
    >
      <Icon size={12} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: fg[1], lineHeight: 1.4 }}>{problem.message}</div>
        <div style={{ fontSize: 10, color: fg[3], fontFamily: 'monospace', marginTop: 1 }}>
          {problem.filePath.split('/').pop()}:{problem.line}:{problem.col}
          {problem.source ? ` · ${problem.source}` : ''}
        </div>
      </div>
    </div>
  )
}

export function ProblemsPanel() {
  const problems = useProblemsStore((s) => s.problems)

  if (problems.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={20} />}
        title="No problems"
        description="Diagnostics from the editor will appear here as you work."
      />
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {problems.map((p) => (
        <ProblemRow key={p.id} problem={p} />
      ))}
    </div>
  )
}
