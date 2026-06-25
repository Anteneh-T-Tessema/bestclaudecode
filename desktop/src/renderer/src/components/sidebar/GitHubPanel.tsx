import { useState, useEffect, useCallback } from 'react'
import { Github, RefreshCw, GitPullRequest, CircleDot, ExternalLink, Check, MessageSquare, XCircle, Bot, CheckCircle2, AlertCircle, Loader2, Activity } from 'lucide-react'
import { EmptyState } from '../EmptyState'
import { toast } from '../../store/useToastStore'
import { PanelHeader, IconButton, accent, border, fg, surface } from '../../design'
import { useChatStore } from '../../store/useChatStore'
import { AiPrReviewDraft, type ReviewDraft } from './AiPrReviewDraft'

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

type Kind = 'prs' | 'issues' | 'runs'
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
  const [aiReviewLoading, setAiReviewLoading] = useState(false)
  const [aiReviewDraft, setAiReviewDraft] = useState<ReviewDraft | null>(null)
  const activeModel = useChatStore((s) => s.activeModel)

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

  const generateAiReview = async () => {
    setAiReviewLoading(true)
    try {
      const diff = await window.api.github.getPrDiff(item.number)
      if (!diff.trim()) { toast.error('No diff available for this PR'); return }
      const changedFiles = [...diff.matchAll(/diff --git a\/([^ ]+)/g)].map((m) => m[1])
      const streamId = await window.api.ai.streamChat({
        messages: [{
          role: 'user',
          content: `Review this pull request diff. Respond ONLY with valid JSON matching this schema: {"summary": "overall summary", "comments": [{"path": "file", "line": 1, "body": "issue"}]}. Be specific and actionable. PR #${item.number}: ${item.title}\n\nChanged files: ${changedFiles.join(', ')}\n\n${diff.slice(0, 14000)}`,
        }],
        model: activeModel,
        systemPrompt: 'You are a senior code reviewer. Respond ONLY with valid JSON — no markdown fences, no commentary outside the JSON object.',
      })
      let text = ''
      await new Promise<void>((resolve, reject) => {
        const unChunk = window.api.ai.onChunk(streamId, (d) => { text += d })
        const unDone = window.api.ai.onDone(streamId, () => { unChunk(); unDone(); unErr(); resolve() })
        const unErr = window.api.ai.onError(streamId, (e) => { unChunk(); unDone(); unErr(); reject(new Error(e)) })
      })
      try {
        const parsed = JSON.parse(text.trim()) as ReviewDraft
        setAiReviewDraft({ summary: parsed.summary ?? '', comments: parsed.comments ?? [] })
      } catch {
        setAiReviewDraft({ summary: text.trim(), comments: [] })
      }
    } catch (err) {
      toast.error(`AI review failed: ${(err as Error).message}`)
    } finally {
      setAiReviewLoading(false)
    }
  }

  const postAiReview = async (draft: ReviewDraft) => {
    const ok = await window.api.github.postReviewComments(item.number, draft.summary, 'COMMENT', draft.comments)
    if (ok) {
      toast.success('Review posted')
      setAiReviewDraft(null)
      onChanged()
    } else {
      toast.error('Failed to post review — check gh CLI auth')
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
        {kind === 'prs' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void generateAiReview() }}
            disabled={aiReviewLoading}
            title="Generate AI review"
            style={{
              background: 'none', border: 'none', cursor: aiReviewLoading ? 'not-allowed' : 'pointer',
              color: aiReviewLoading ? fg[4] : accent.violet.fg, display: 'flex', flexShrink: 0, marginTop: 1,
            }}
          >
            <Bot size={12} />
          </button>
        )}
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

      {aiReviewDraft && (
        <AiPrReviewDraft
          draft={aiReviewDraft}
          onPost={(d) => void postAiReview(d)}
          onCancel={() => setAiReviewDraft(null)}
        />
      )}

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

interface WorkflowRun {
  databaseId: number
  name: string
  status: string
  conclusion: string | null
  url: string
  createdAt: string
}

function RunStatusIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status === 'completed') {
    if (conclusion === 'success') return <CheckCircle2 size={11} style={{ color: accent.green.fg }} />
    if (conclusion === 'failure') return <XCircle size={11} style={{ color: accent.red.fg }} />
    return <AlertCircle size={11} style={{ color: accent.amber.fg }} />
  }
  return <Loader2 size={11} style={{ color: accent.cyan.fg, animation: 'spin 1s linear infinite' }} />
}

function RunRow({ run }: { run: WorkflowRun }) {
  const age = (() => {
    const d = new Date(run.createdAt)
    const mins = Math.floor((Date.now() - d.getTime()) / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  })()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${border[0]}` }}>
      <RunStatusIcon status={run.status} conclusion={run.conclusion} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: fg[0], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.name}
        </div>
        <div style={{ fontSize: 9, color: fg[3], marginTop: 2 }}>{run.status}{run.conclusion ? ` · ${run.conclusion}` : ''} · {age}</div>
      </div>
      <a href={run.url} target="_blank" rel="noreferrer" aria-label="Open run in GitHub" style={{ color: fg[3], display: 'flex' }}>
        <ExternalLink size={10} />
      </a>
    </div>
  )
}

export function GitHubPanel() {
  const [kind, setKind] = useState<Kind>('prs')
  const [stateFilter, setStateFilter] = useState<StateFilter>('open')
  const [items, setItems] = useState<GithubListItem[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      if (kind === 'runs') {
        const branch = await window.api.git.branch(window.api.settings.get('projectPath') as unknown as string).catch(() => null)
        const result = await window.api.github.listWorkflowRuns(branch ?? 'main')
        setRuns(result)
      } else {
        const result = kind === 'prs'
          ? await window.api.github.listPrs(stateFilter)
          : await window.api.github.listIssues(stateFilter)
        setItems(result)
      }
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

  const TAB_LABELS: Record<Kind, string> = { prs: 'Pull Requests', issues: 'Issues', runs: 'CI Runs' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Github style={{ width: 13, height: 13, color: accent.violet.fg }} />}
        label="GitHub"
        actions={headerActions}
      />

      <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        {(['prs', 'issues', 'runs'] as Kind[]).map((k) => (
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
            {TAB_LABELS[k]}
          </button>
        ))}
        {kind !== 'runs' && (
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
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <EmptyState
            icon={<Github size={20} />}
            title="GitHub CLI not available"
            description="Requires the `gh` CLI installed and authenticated (`gh auth login`) in this project's repo."
          />
        )}
        {kind === 'runs' && !error && !loading && runs.length === 0 && (
          <EmptyState
            icon={<Activity size={20} />}
            title="No workflow runs"
            description="No CI runs found for the current branch."
          />
        )}
        {kind === 'runs' && runs.map((run) => <RunRow key={run.databaseId} run={run} />)}
        {kind !== 'runs' && !error && !loading && items.length === 0 && (
          <EmptyState
            icon={kind === 'prs' ? <GitPullRequest size={20} /> : <CircleDot size={20} />}
            title={`No ${stateFilter} ${kind === 'prs' ? 'pull requests' : 'issues'}`}
            description="Nothing to show for this filter."
          />
        )}
        {kind !== 'runs' && items.map((item) => (
          <ItemRow key={item.number} item={item} kind={kind as 'prs' | 'issues'} onChanged={load} />
        ))}
      </div>
    </div>
  )
}
