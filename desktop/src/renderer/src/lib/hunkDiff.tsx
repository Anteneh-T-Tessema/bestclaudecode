import { border, fg, surface, accent } from '../design'
import { Check, XSquare } from 'lucide-react'

// ── Per-hunk diff engine ────────────────────────────────────────────────────

type LineType = 'eq' | 'add' | 'del'

interface DiffLine { type: LineType; text: string }

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])
  return dp
}

export function diffLines(original: string, modified: string): DiffLine[] {
  const a = original === '' ? [] : original.split('\n')
  const b = modified === '' ? [] : modified.split('\n')
  const dp = lcsTable(a, b)
  const ops: DiffLine[] = []
  let i = a.length, j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      ops.push({ type: 'eq', text: a[i-1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.push({ type: 'add', text: b[j-1] }); j--
    } else {
      ops.push({ type: 'del', text: a[i-1] }); i--
    }
  }
  return ops.reverse()
}

export interface Hunk {
  id: number
  contextBefore: string[]
  removed: string[]
  added: string[]
  contextAfter: string[]
}

const CTX = 3

export function buildHunks(diff: DiffLine[]): Hunk[] {
  // Split into groups: unchanged blocks vs changed blocks
  const groups: Array<{ type: 'eq' | 'change'; lines: DiffLine[] }> = []
  for (const dl of diff) {
    const last = groups[groups.length - 1]
    const gtype = dl.type === 'eq' ? 'eq' : 'change'
    if (last && last.type === gtype) last.lines.push(dl)
    else groups.push({ type: gtype, lines: [dl] })
  }
  const hunks: Hunk[] = []
  let id = 0
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    if (g.type !== 'change') continue
    const prevEq = gi > 0 && groups[gi-1].type === 'eq' ? groups[gi-1].lines.map(l => l.text) : []
    const nextEq = gi < groups.length - 1 && groups[gi+1].type === 'eq' ? groups[gi+1].lines.map(l => l.text) : []
    hunks.push({
      id: id++,
      contextBefore: prevEq.slice(-CTX),
      removed: g.lines.filter(l => l.type === 'del').map(l => l.text),
      added: g.lines.filter(l => l.type === 'add').map(l => l.text),
      contextAfter: nextEq.slice(0, CTX),
    })
  }
  return hunks
}

function findHunkStart(a: string[], ctxBefore: string[], removed: string[], from: number): number {
  if (ctxBefore.length > 0) {
    const anchor = ctxBefore[ctxBefore.length - 1]
    for (let i = from; i < a.length; i++) {
      if (a[i] === anchor) return i + 1
    }
  }
  if (removed.length > 0) {
    for (let i = from; i < a.length; i++) {
      if (a[i] === removed[0]) return i
    }
  }
  return from
}

export function applyHunks(original: string, hunks: Hunk[], accepted: Set<number>): string {
  const a = original === '' ? [] : original.split('\n')
  let ai = 0
  const out: string[] = []
  for (const h of hunks) {
    const hunkStart = findHunkStart(a, h.contextBefore, h.removed, ai)
    while (ai < hunkStart) { out.push(a[ai]); ai++ }
    out.push(...(accepted.has(h.id) ? h.added : h.removed))
    ai += h.removed.length
  }
  while (ai < a.length) { out.push(a[ai]); ai++ }
  return out.join('\n')
}

// ── HunkCard component ──────────────────────────────────────────────────────

export function HunkCard({ hunk, accepted, onToggle }: { hunk: Hunk; accepted: boolean; onToggle: () => void }) {
  const isNoop = hunk.removed.length === 0 && hunk.added.length === 0
  return (
    <div style={{ borderBottom: `1px solid ${border[2]}`, fontFamily: 'monospace', fontSize: 11 }}>
      {/* Context before */}
      {hunk.contextBefore.map((line, i) => (
        <div key={`cb-${i}`} style={{ padding: '1px 10px', color: fg[4], whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {' '}{line}
        </div>
      ))}
      {/* Changed lines */}
      <div style={{ position: 'relative' }}>
        {!isNoop && (
          <div style={{
            position: 'absolute', right: 8, top: 4, display: 'flex', gap: 4, zIndex: 1,
          }}>
            <button
              type="button"
              onClick={onToggle}
              title={accepted ? 'Reject this hunk' : 'Accept this hunk'}
              style={{
                background: accepted ? accent.green.fg : surface.raised,
                border: `1px solid ${accepted ? accent.green.fg : border[0]}`,
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                color: accepted ? '#06150c' : fg[2],
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {accepted ? <><Check size={10} /> Accepted</> : <><XSquare size={10} /> Rejected</>}
            </button>
          </div>
        )}
        {hunk.removed.map((line, i) => (
          <div key={`del-${i}`} style={{
            padding: '1px 10px',
            background: 'rgba(240,80,80,0.12)',
            color: '#f08080',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            opacity: accepted ? 0.5 : 1,
          }}>
            {'- '}{line}
          </div>
        ))}
        {hunk.added.map((line, i) => (
          <div key={`add-${i}`} style={{
            padding: '1px 10px',
            background: 'rgba(80,200,120,0.12)',
            color: '#80d880',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            opacity: accepted ? 1 : 0.4,
          }}>
            {'+ '}{line}
          </div>
        ))}
      </div>
      {/* Context after */}
      {hunk.contextAfter.map((line, i) => (
        <div key={`ca-${i}`} style={{ padding: '1px 10px', color: fg[4], whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {' '}{line}
        </div>
      ))}
    </div>
  )
}
