import { useState } from 'react'
import { Globe, Play, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react'
import type { BrowseBlock } from '../../lib/editBlocks'
import { surface, border, fg, accent } from '../../design'

export function BrowseProposalCard({ block }: { block: BrowseBlock }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [output, setOutput] = useState('')
  const [expanded, setExpanded] = useState(false)

  const run = async () => {
    setStatus('running')
    setOutput('')
    setExpanded(true)
    try {
      const result = await window.api.search.browse(block.url, block.task)
      setOutput(result.result.slice(0, 6000))
      setStatus(result.success ? 'done' : 'error')
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

  return (
    <div
      style={{
        margin: '10px 0',
        border: `1px solid ${border[1]}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: surface.void,
      }}
    >
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
        <Globe size={13} style={{ color: fg[3], flexShrink: 0 }} />
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
            {block.url}
          </code>
          <span style={{ fontSize: 10, color: fg[4] }}>{block.task}</span>
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

        {status === 'idle' && (
          <button
            type="button"
            onClick={run}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 4, border: 'none',
              background: accent.violet.fg, color: '#fff',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Play size={10} />
            Browse
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
