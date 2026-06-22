import { useState } from 'react'
import { Terminal, Play, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, AlertTriangle, ShieldOff } from 'lucide-react'
import type { RunBlock } from '../../lib/editBlocks'
import { surface, border, fg, accent } from '../../design'
import { useSettingsStore } from '../../store/useSettingsStore'
import { classifyCommand } from '../../lib/commandClassifier'

export function RunProposalCard({ block }: { block: RunBlock }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [output, setOutput] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const projectPath = useSettingsStore((s) => s.projectPath)

  const { level, reason } = classifyCommand(block.command)
  const cwd = projectPath ?? '~'

  const run = async () => {
    setStatus('running')
    setOutput('')
    setExpanded(true)
    try {
      const result = await window.api.terminal.runCommand(block.command, projectPath ?? undefined)
      const combined = (result.stdout + result.stderr).trim().slice(0, 6000)
      setOutput(combined)
      setStatus(result.exitCode === 0 ? 'done' : 'error')
      // Fire-and-forget audit log
      window.api.terminal.logRun(block.command, cwd, result.exitCode, combined.slice(0, 200))
    } catch (err) {
      setOutput((err as Error).message)
      setStatus('error')
    }
  }

  const statusColor = status === 'done' ? accent.green.fg : status === 'error' ? accent.red.fg : fg[3]
  const StatusIcon =
    status === 'running' ? Loader2
    : status === 'done' ? CheckCircle2
    : status === 'error' ? XCircle
    : null

  const headerBorderColor =
    level === 'blocked' ? accent.red.border
    : level === 'warn' ? accent.amber.border
    : border[1]

  return (
    <div
      style={{
        margin: '10px 0',
        border: `1px solid ${headerBorderColor}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: surface.void,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: surface.raised,
          borderBottom: `1px solid ${border[2]}`,
        }}
      >
        <Terminal size={13} style={{ color: level === 'blocked' ? accent.red.fg : level === 'warn' ? accent.amber.fg : fg[3], flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <code
            style={{
              display: 'block',
              fontSize: 12,
              fontFamily: 'monospace',
              color: fg[0],
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {block.command}
          </code>
          <span style={{ fontSize: 10, color: fg[4], fontFamily: 'monospace' }}>cwd: {cwd}</span>
        </div>

        {StatusIcon && (
          <StatusIcon
            size={13}
            style={{
              color: statusColor,
              animation: status === 'running' ? 'spin 1s linear infinite' : undefined,
              flexShrink: 0,
            }}
          />
        )}

        {status === 'idle' && level === 'safe' && (
          <button
            type="button"
            onClick={run}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 4, border: 'none',
              background: accent.amber.fg, color: surface.void,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Play size={10} />
            Run
          </button>
        )}

        {status === 'idle' && level === 'warn' && confirmed && (
          <button
            type="button"
            onClick={run}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 4, border: `1px solid ${accent.red.border}`,
              background: accent.red.subtle, color: accent.red.fg,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Play size={10} />
            Run anyway
          </button>
        )}

        {output && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], padding: 0, flexShrink: 0 }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>

      {/* Hard-blocked banner */}
      {level === 'blocked' && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            background: accent.red.subtle,
            borderTop: `1px solid ${accent.red.border}`,
          }}
        >
          <ShieldOff size={13} style={{ color: accent.red.fg, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: accent.red.fg }}>
            <strong>Blocked:</strong> {reason}. Edit the command in the terminal if you intended this.
          </span>
        </div>
      )}

      {/* Warn-then-confirm banner */}
      {level === 'warn' && status === 'idle' && !confirmed && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            background: accent.amber.subtle,
            borderTop: `1px solid ${accent.amber.border}`,
          }}
        >
          <AlertTriangle size={13} style={{ color: accent.amber.fg, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 11, color: accent.amber.fg }}>
            <strong>Caution:</strong> {reason}.
          </span>
          <button
            type="button"
            onClick={() => setConfirmed(true)}
            style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              border: `1px solid ${accent.amber.border}`, background: 'none',
              color: accent.amber.fg, cursor: 'pointer', flexShrink: 0,
            }}
          >
            I understand
          </button>
        </div>
      )}

      {/* Output */}
      {output && expanded && (
        <pre
          style={{
            margin: 0,
            padding: '10px 12px',
            fontSize: 11,
            fontFamily: 'monospace',
            color: status === 'error' ? accent.red.fg : fg[1],
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {output}
        </pre>
      )}
    </div>
  )
}
