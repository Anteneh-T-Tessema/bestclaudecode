import { useState } from 'react'
import { AlertCircle, AlertTriangle, Info, CheckCircle2, ChevronRight, Sparkles, type LucideIcon } from 'lucide-react'
import { useProblemsStore, type Problem, type ProblemSeverity } from '../store/useProblemsStore'
import { useEditorStore } from '../store/useEditorStore'
import { useAppStore } from '../store/useAppStore'
import { EmptyState } from './EmptyState'
import { accent, fg, border, surface } from '../design'

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

const SEVERITY_ORDER: Record<ProblemSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
}

function ProblemRow({ problem }: { problem: Problem }) {
  const openFile = useEditorStore((s) => s.openFile)
  const setActiveActivity = useAppStore((s) => s.setActiveActivity)
  const [hovered, setHovered] = useState(false)
  const Icon = SEVERITY_ICON[problem.severity]
  const color = SEVERITY_COLOR[problem.severity]

  const handleClick = async () => {
    try {
      const content = await window.api.fs.readFile(problem.filePath)
      openFile(problem.filePath, content)
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('meshflow:goToLine', { detail: { line: problem.line, column: problem.col } })
        )
      }, 80)
    } catch {
      // file may have moved
    }
  }

  const fixWithAI = async (e: React.MouseEvent) => {
    e.stopPropagation()
    let codeContext = ''
    try {
      const content = await window.api.fs.readFile(problem.filePath)
      const lines = content.split('\n')
      const start = Math.max(0, problem.line - 6)
      const end = Math.min(lines.length, problem.line + 5)
      const snippet = lines.slice(start, end).join('\n')
      const fileName = problem.filePath.split('/').pop() ?? problem.filePath
      const ext = fileName.split('.').pop() ?? ''
      codeContext = `\`\`\`${ext}\n${snippet}\n\`\`\``
      openFile(problem.filePath, content)
    } catch { /* file may have moved */ }

    const fileName = problem.filePath.split('/').pop() ?? problem.filePath
    const locationStr = `Ln ${problem.line}, Col ${problem.col}`
    const prompt =
      `Fix this ${problem.severity} in \`${fileName}\`:\n\n` +
      `**${problem.severity.toUpperCase()} ${locationStr}**: ${problem.message}\n\n` +
      (codeContext ? `${codeContext}\n\n` : '') +
      `Fix the issue. Keep all other behavior unchanged.`

    setActiveActivity('chat')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('meshflow:chat:regenerate', { detail: { content: prompt } }))
    }, 50)
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '4px 14px 4px 28px',
        cursor: 'pointer',
        background: hovered ? surface.overlay : 'transparent',
        position: 'relative',
      }}
    >
      <Icon size={11} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: fg[1], lineHeight: 1.4 }}>{problem.message}</div>
        <div style={{ fontSize: 10, color: fg[3], fontFamily: 'monospace', marginTop: 1 }}>
          Ln {problem.line}, Col {problem.col}
          {problem.source ? ` · ${problem.source}` : ''}
        </div>
      </div>
      {hovered && (
        <button
          type="button"
          onClick={fixWithAI}
          title="Fix with AI"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            background: surface.surface,
            border: `1px solid ${accent.violet.border}`,
            borderRadius: 4,
            cursor: 'pointer',
            color: accent.violet.fg,
            fontSize: 10,
            fontWeight: 600,
            flexShrink: 0,
            alignSelf: 'center',
          }}
        >
          <Sparkles size={10} />
          Fix
        </button>
      )}
    </div>
  )
}

function FileGroup({ filePath, problems }: { filePath: string; problems: Problem[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const fileName = filePath.split('/').pop() ?? filePath
  const errorCount = problems.filter((p) => p.severity === 'error').length
  const warnCount = problems.filter((p) => p.severity === 'warning').length

  const sorted = [...problems].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line
  )

  return (
    <div style={{ borderBottom: `1px solid ${border[2]}` }}>
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          cursor: 'pointer',
          background: surface.raised,
          userSelect: 'none',
        }}
      >
        <ChevronRight
          size={12}
          color={fg[3]}
          style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.12s', flexShrink: 0 }}
        />
        <span style={{ fontSize: 11, fontWeight: 600, color: fg[1], flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </span>
        {errorCount > 0 && (
          <span style={{ fontSize: 10, color: accent.red.fg, fontWeight: 700, flexShrink: 0 }}>
            {errorCount}E
          </span>
        )}
        {warnCount > 0 && (
          <span style={{ fontSize: 10, color: accent.amber.fg, fontWeight: 700, flexShrink: 0 }}>
            {warnCount}W
          </span>
        )}
      </div>
      {!collapsed && sorted.map((p) => <ProblemRow key={p.id} problem={p} />)}
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

  const grouped: Record<string, Problem[]> = {}
  for (const p of problems) {
    if (!grouped[p.filePath]) grouped[p.filePath] = []
    grouped[p.filePath].push(p)
  }

  const filesSorted = Object.keys(grouped).sort((a, b) => {
    const aHasError = grouped[a].some((p) => p.severity === 'error')
    const bHasError = grouped[b].some((p) => p.severity === 'error')
    if (aHasError !== bHasError) return aHasError ? -1 : 1
    return a.localeCompare(b)
  })

  const totalErrors = problems.filter((p) => p.severity === 'error').length
  const totalWarns = problems.filter((p) => p.severity === 'warning').length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          padding: '4px 12px',
          fontSize: 10,
          color: fg[3],
          borderBottom: `1px solid ${border[1]}`,
          display: 'flex',
          gap: 10,
          flexShrink: 0,
        }}
      >
        {totalErrors > 0 && (
          <span style={{ color: accent.red.fg }}>
            <AlertCircle size={10} style={{ display: 'inline', marginRight: 3 }} />
            {totalErrors} error{totalErrors !== 1 ? 's' : ''}
          </span>
        )}
        {totalWarns > 0 && (
          <span style={{ color: accent.amber.fg }}>
            <AlertTriangle size={10} style={{ display: 'inline', marginRight: 3 }} />
            {totalWarns} warning{totalWarns !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filesSorted.map((fp) => (
          <FileGroup key={fp} filePath={fp} problems={grouped[fp]} />
        ))}
      </div>
    </div>
  )
}
