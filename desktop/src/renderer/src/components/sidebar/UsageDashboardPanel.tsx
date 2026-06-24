import { useMemo } from 'react'
import { DollarSign } from 'lucide-react'
import { useChatStore } from '../../store/useChatStore'
import { EmptyState } from '../EmptyState'
import { PanelHeader, accent, border, fg, surface } from '../../design'

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

function formatTokens(n: number): string {
  return n > 999 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Gap 56 — totals across every persisted chat session, sourced from ChatSession.usage (Gap 56 in useChatStore). */
export function UsageDashboardPanel() {
  const sessions = useChatStore((s) => s.sessions)

  const rows = useMemo(
    () => sessions
      .filter((s) => s.usage && (s.usage.inputTokens > 0 || s.usage.outputTokens > 0))
      .sort((a, b) => b.createdAt - a.createdAt),
    [sessions],
  )

  const totals = useMemo(
    () => rows.reduce(
      (acc, s) => ({
        inputTokens: acc.inputTokens + (s.usage?.inputTokens ?? 0),
        outputTokens: acc.outputTokens + (s.usage?.outputTokens ?? 0),
        costUsd: acc.costUsd + (s.usage?.costUsd ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    ),
    [rows],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<DollarSign style={{ width: 13, height: 13, color: accent.green.fg }} />}
        label="Usage Dashboard"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<DollarSign size={28} />}
          title="No usage recorded yet"
          description="Token usage and estimated cost will appear here once you chat with the AI."
        />
      ) : (
        <>
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderBottom: `1px solid ${border[1]}`,
              background: surface.raised, flexShrink: 0,
            }}
          >
            <div>
              <div style={{ fontSize: 9, color: fg[4], textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                Total across {rows.length} session{rows.length === 1 ? '' : 's'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: fg[0], fontFamily: 'monospace' }}>
                {formatTokens(totals.inputTokens)}↑ {formatTokens(totals.outputTokens)}↓
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: accent.green.fg, fontFamily: 'monospace' }}>
              {formatCost(totals.costUsd)}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {rows.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderBottom: `1px solid ${border[2]}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: fg[1], fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title}
                  </div>
                  <div style={{ fontSize: 9, color: fg[4], marginTop: 2 }}>
                    {new Date(s.createdAt).toLocaleDateString()} · {s.usage?.lastModel}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: fg[3], fontFamily: 'monospace' }}>
                    {formatTokens(s.usage?.inputTokens ?? 0)}↑ {formatTokens(s.usage?.outputTokens ?? 0)}↓
                  </div>
                  <div style={{ fontSize: 11, color: accent.green.fg, fontFamily: 'monospace', fontWeight: 600 }}>
                    {formatCost(s.usage?.costUsd ?? 0)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
