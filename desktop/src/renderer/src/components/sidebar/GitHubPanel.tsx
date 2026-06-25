import { useState, useEffect, useCallback } from 'react'
import { Github, RefreshCw, GitPullRequest, CircleDot, ExternalLink, Check, MessageSquare, XCircle } from 'lucide-react'
import { EmptyState } from '../EmptyState'
import { toast } from '../../store/useToastStore'
import { PanelHeader, IconButton, accent, border, fg, surface } from '../../design'

interface GithubListItem {
  number: number
  title: string
  url: string
  author: string
  state: string
  updatedAt: string
  isDraft?: boolean
  labels?: string[]
}

type Kind = 'prs' | 'issues'
type StateFilter = 'open' | 'closed' | 'all'

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return `${months} month${months !== 1 ? 's' : ''} ago`
}

// Gap 100/101 — browse open PRs/issues and review a PR (comment, approve,
// request changes) without leaving the IDE or already knowing the number.
function ItemRow({ item, kind, onChanged }: { item: GithubListItem; kind: Kind; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState<'approve' | 'request-changes' | 'comment' | null>(null)

  const submit = async (action: 'approve' | 'request-changes' | 'comment') => {
    if (action === 'comment' && !comment.trim()) return
    setSubmitting(action)
    try {
      const ok = action === 'comment'
        ? await window.api.github.commentOnPr(item.number, comment.trim())
        : await window.api.github.reviewPr(item.number, action, comment.trim() || undefined)
      if (ok) {
        toast.success(action === 'approve' ? 'Approved' : action === 'request-changes' ? 'Changes requested' : 'Comment posted')
        setComment('')
        onChanged()
      } else {
        toast.error(`Failed to ${action === 'comment' ? 'post comment' : action.replace('-', ' ')}`)
      }
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div style={{ borderBottom: `1px solid ${border[2]}` }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start' }}
      >
        {kind === 'prs'
          ? <GitPullRequest size={13} color={item.isDraft ? fg[4] : accent.green.fg} style={{ flexShrink: 0, marginTop: 1 }} />
          : <CircleDot size={13} color={accent.green.fg} style={{ flexShrink: 0, marginTop: 1 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: fg[0], lineHeight: 1.4 }}>
            <span style={{ color: fg[4], fontFamily: 'monospace' }}>#{item.number}</span> {item.title}
            {item.isDraft && (
              <span style={{ fontSize: 9, color: fg[4], marginLeft: 6, border: `1px solid ${border[1]}`, borderRadius: 3, padding: '0 4px' }}>
                DRAFT
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: fg[3], marginTop: 2 }}>
            {item.author} · {relativeDate(item.updatedAt)}
          </div>
          {item.labels && item.labels.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {item.labels.map((l) => (
                <span key={l} style={{ fontSize: 9, color: accent.cyan.fg, background: accent.cyan.subtle, border: `1px solid ${accent.cyan.border}`, borderRadius: 10, padding: '1px 6px' }}>
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open on GitHub"
          style={{ flexShrink: 0, color: fg[4], display: 'flex', marginTop: 1 }}
        >
          <ExternalLink size={12} />
        </a>
      </div>

      {expanded && kind === 'prs' && (
        <div style={{ padding: '0 12px 10px 33px' }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Review comment (optional for approve/request changes)…"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              background: surface.raised, border: `1px solid ${border[0]}`, borderRadius: 4,
              padding: '5px 7px', fontSize: 11, color: fg[0], outline: 'none', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => void submit('approve')}
              disabled={submitting !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 4,
                border: `1px solid ${accent.green.border}`, background: accent.green.subtle, color: accent.green.fg,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              <Check size={10} /> {submitting === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              onClick={() => void submit('request-changes')}
              disabled={submitting !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 4,
                border: `1px solid ${accent.red.border}`, background: accent.red.subtle, color: accent.red.fg,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              <XCircle size={10} /> {submitting === 'request-changes' ? 'Submitting…' : 'Request Changes'}
            </button>
            <button
              type="button"
              onClick={() => void submit('comment')}
              disabled={submitting !== null || !comment.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 4,
                border: `1px solid ${border[0]}`, background: surface.raised, color: fg[2],
                cursor: submitting || !comment.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              <MessageSquare size={10} /> {submitting === 'comment' ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function GitHubPanel() {
  const [kind, setKind] = useState<Kind>('prs')
  const [stateFilter, setStateFilter] = useState<StateFilter>('open')
  const [items, setItems] = useState<GithubListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const result = kind === 'prs'
        ? await window.api.github.listPrs(stateFilter)
        : await window.api.github.listIssues(stateFilter)
      setItems(result)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [kind, stateFilter])

  useEffect(() => { load() }, [load])

  const headerActions = (
    <IconButton size={22} onClick={load} disabled={loading} title="Refresh">
      <RefreshCw style={{ width: 11, height: 11 }} className={loading ? 'agent-pulse' : ''} />
    </IconButton>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Github style={{ width: 13, height: 13, color: accent.violet.fg }} />}
        label="GitHub"
        actions={headerActions}
      />

      <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        {(['prs', 'issues'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${kind === k ? accent.violet.border : border[1]}`,
              background: kind === k ? accent.violet.subtle : 'transparent',
              color: kind === k ? accent.violet.fg : fg[3],
            }}
          >
            {k === 'prs' ? 'Pull Requests' : 'Issues'}
          </button>
        ))}
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as StateFilter)}
          title="Filter by state"
          style={{
            marginLeft: 'auto', background: surface.raised, border: `1px solid ${border[0]}`,
            borderRadius: 4, padding: '2px 6px', fontSize: 10, color: fg[0], outline: 'none',
          }}
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <EmptyState
            icon={<Github size={20} />}
            title="GitHub CLI not available"
            description="Requires the `gh` CLI installed and authenticated (`gh auth login`) in this project's repo."
          />
        )}
        {!error && !loading && items.length === 0 && (
          <EmptyState
            icon={kind === 'prs' ? <GitPullRequest size={20} /> : <CircleDot size={20} />}
            title={`No ${stateFilter} ${kind === 'prs' ? 'pull requests' : 'issues'}`}
            description="Nothing to show for this filter."
          />
        )}
        {items.map((item) => (
          <ItemRow key={item.number} item={item} kind={kind} onChanged={load} />
        ))}
      </div>
    </div>
  )
}
