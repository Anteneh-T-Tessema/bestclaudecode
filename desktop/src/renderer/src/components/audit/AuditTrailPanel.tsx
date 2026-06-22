import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, Search, ChevronDown, ChevronRight, RefreshCw, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { EmptyState } from '../EmptyState'
import { PanelHeader, IconButton, accent, border, fg, surface } from '../../design'
import type { ParsedDecision, DecisionStats } from '../../../../main/ipc/decisions.handlers'

function verdictColor(verdict: string): { fg: string; subtle: string; border: string } {
  const key = verdict.split(':')[0].trim().toLowerCase()
  if (key.includes('lgtm') || key.includes('approved') || key.includes('pass')) {
    return { fg: accent.green.fg, subtle: accent.green.subtle, border: accent.green.border }
  }
  if (key.includes('blocking')) {
    return { fg: accent.red.fg, subtle: accent.red.subtle, border: accent.red.border }
  }
  if (key.includes('should-fix') || key.includes('warn')) {
    return { fg: accent.amber.fg, subtle: accent.amber.subtle, border: accent.amber.border }
  }
  return { fg: fg[2], subtle: surface.raised, border: border[0] }
}

function verdictIcon(verdict: string) {
  const key = verdict.split(':')[0].trim().toLowerCase()
  if (key.includes('lgtm') || key.includes('approved') || key.includes('pass')) return CheckCircle2
  if (key.includes('blocking')) return AlertTriangle
  return Info
}

function DecisionRow({ entry, expanded, onToggle }: { entry: ParsedDecision; expanded: boolean; onToggle: () => void }) {
  const [hovered, setHovered] = useState(false)
  const colors = verdictColor(entry.verdict)
  const Icon = verdictIcon(entry.verdict)

  return (
    <div data-testid="audit-entry" style={{ borderBottom: `1px solid ${border[1]}` }}>
      <div
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '8px 12px', cursor: 'pointer',
          background: hovered ? surface.raised : 'transparent',
          transition: 'background 0.1s',
        }}
      >
        <Icon style={{ width: 13, height: 13, color: colors.fg, flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 12, color: fg[0], fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>
              {entry.task}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: colors.fg, background: colors.subtle, border: `1px solid ${colors.border}`,
              borderRadius: 4, padding: '1px 6px', flexShrink: 0,
            }}>
              {entry.verdict}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span style={{ fontSize: 10, color: fg[3], fontFamily: 'monospace' }}>{entry.agent}</span>
            {entry.retries > 0 && (
              <span style={{ fontSize: 10, color: accent.amber.fg }}>{entry.retries} retry</span>
            )}
            <span style={{ fontSize: 10, color: fg[3], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.outcome}
            </span>
          </div>
          {expanded && entry.findings.length > 0 && (
            <div style={{
              marginTop: 8, padding: '6px 8px', background: surface.raised, borderRadius: 4,
              display: 'flex', flexDirection: 'column', gap: 3,
            }}>
              {entry.findings.map((f, i) => (
                <div key={i} style={{ fontSize: 10, color: fg[2], display: 'flex', gap: 5 }}>
                  <span style={{ color: fg[4] }}>·</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {entry.findings.length > 0 && (
          expanded
            ? <ChevronDown style={{ width: 11, height: 11, color: fg[3], flexShrink: 0, marginTop: 2 }} />
            : <ChevronRight style={{ width: 11, height: 11, color: fg[4], flexShrink: 0, marginTop: 2 }} />
        )}
      </div>
    </div>
  )
}

export function AuditTrailPanel() {
  const [entries, setEntries] = useState<ParsedDecision[]>([])
  const [stats, setStats] = useState<DecisionStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, s] = await Promise.all([
        query ? window.api.decisions.search(query) : window.api.decisions.list(),
        window.api.decisions.stats(),
      ])
      setEntries(list)
      setStats(s)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { load() }, [load])

  const headerActions = (
    <IconButton size={22} onClick={load} title="Refresh">
      <RefreshCw style={{ width: 11, height: 11 }} className={loading ? 'agent-pulse' : undefined} />
    </IconButton>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<ShieldCheck style={{ width: 13, height: 13, color: accent.green.fg }} />}
        label="Audit Trail"
        actions={headerActions}
      />

      <div style={{ padding: '3px 12px 6px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        <p style={{ fontSize: 10, color: fg[3], margin: 0 }}>
          Every agent decision, logged and reviewable — not a black box.
        </p>
      </div>

      {stats && stats.total > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1,
          background: border[1], borderBottom: `1px solid ${border[1]}`, flexShrink: 0,
        }}>
          {[
            { value: String(stats.total), label: 'Cycles', color: fg[1] },
            { value: `${stats.retryRatePct}%`, label: 'Retry rate', color: stats.retryRatePct > 0 ? accent.amber.fg : fg[1] },
            { value: String(stats.agents.length), label: 'Agents', color: accent.cyan.fg },
          ].map((s) => (
            <div key={s.label} style={{ background: surface.surface, padding: '8px 4px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
              <div style={{ fontSize: 9, color: fg[3], textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {stats && Object.keys(stats.verdictCounts).length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 12px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
          {Object.entries(stats.verdictCounts).map(([verdict, count]) => {
            const colors = verdictColor(verdict)
            return (
              <span key={verdict} style={{
                fontSize: 9, fontWeight: 700, color: colors.fg, background: colors.subtle,
                border: `1px solid ${colors.border}`, borderRadius: 4, padding: '2px 7px',
              }}>
                {verdict}: {count}
              </span>
            )
          })}
        </div>
      )}

      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', width: 11, height: 11, color: fg[3] }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search task, verdict, outcome, findings…"
            style={{
              width: '100%', paddingLeft: 22, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
              background: surface.raised, border: `1px solid ${border[0]}`,
              borderRadius: 3, fontSize: 11, color: fg[0], outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {entries.length === 0 && !loading ? (
          <EmptyState
            icon={<ShieldCheck style={{ width: 22, height: 22 }} />}
            title={query ? 'No matches' : 'No decisions logged yet'}
            description={
              query
                ? 'No decision log entries match your search.'
                : 'Run /implement or /blueprint-build to start building a transparent, reviewable audit trail of every agent decision.'
            }
          />
        ) : (
          entries.map((entry) => (
            <DecisionRow
              key={entry.filename}
              entry={entry}
              expanded={expanded === entry.filename}
              onToggle={() => setExpanded(expanded === entry.filename ? null : entry.filename)}
            />
          ))
        )}
      </div>

      {stats && stats.topFiles.length > 0 && (
        <div style={{ borderTop: `1px solid ${border[1]}`, padding: '6px 12px 8px', flexShrink: 0, maxHeight: 110, overflow: 'auto' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: fg[3], marginBottom: 4 }}>
            Most-flagged files
          </div>
          {stats.topFiles.slice(0, 5).map(({ file, count }) => (
            <div key={file} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '1px 0' }}>
              <span style={{ color: accent.cyan.fg, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file}</span>
              <span style={{ color: accent.red.fg, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
