import { useState } from 'react'
import { X, Trash2, Send } from 'lucide-react'
import { surface, border, fg, accent } from '../../design'

export interface ReviewComment {
  path: string
  line: number
  body: string
}

export interface ReviewDraft {
  summary: string
  comments: ReviewComment[]
}

interface Props {
  draft: ReviewDraft
  onPost: (draft: ReviewDraft) => void
  onCancel: () => void
}

// Gap 129 — editable AI-generated PR review draft. Human reviews and edits
// before posting; consistent with the codebase's human-gate pattern.
export function AiPrReviewDraft({ draft: initial, onPost, onCancel }: Props) {
  const [summary, setSummary] = useState(initial.summary)
  const [comments, setComments] = useState<ReviewComment[]>(initial.comments)

  const removeComment = (idx: number) =>
    setComments((prev) => prev.filter((_, i) => i !== idx))

  const updateComment = (idx: number, field: keyof ReviewComment, value: string | number) =>
    setComments((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c))

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: surface.overlay, border: `1px solid ${border[0]}`, borderRadius: 10,
        width: 560, maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 16px', borderBottom: `1px solid ${border[1]}`,
        }}>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: fg[0] }}>AI PR Review Draft</span>
          <button type="button" onClick={onCancel}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], display: 'flex' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, color: fg[3], display: 'block', marginBottom: 4 }}>Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                background: surface.raised, border: `1px solid ${border[0]}`, borderRadius: 4,
                padding: '6px 8px', fontSize: 11, color: fg[0], outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>

          {comments.length > 0 && (
            <div>
              <label style={{ fontSize: 10, color: fg[3], display: 'block', marginBottom: 6 }}>
                Inline comments ({comments.length})
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {comments.map((c, idx) => (
                  <div key={idx} style={{
                    background: surface.raised, border: `1px solid ${border[1]}`, borderRadius: 6, padding: 10,
                  }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <input
                        value={c.path}
                        onChange={(e) => updateComment(idx, 'path', e.target.value)}
                        placeholder="file/path.ts"
                        style={{
                          flex: 1, background: surface.base, border: `1px solid ${border[0]}`, borderRadius: 3,
                          padding: '3px 6px', fontSize: 10, color: fg[1], outline: 'none', fontFamily: 'monospace',
                        }}
                      />
                      <input
                        type="number"
                        value={c.line}
                        onChange={(e) => updateComment(idx, 'line', parseInt(e.target.value, 10) || 1)}
                        title="Line number"
                        style={{
                          width: 54, background: surface.base, border: `1px solid ${border[0]}`, borderRadius: 3,
                          padding: '3px 6px', fontSize: 10, color: fg[1], outline: 'none', textAlign: 'right',
                        }}
                      />
                      <button type="button" onClick={() => removeComment(idx)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[4], display: 'flex' }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <textarea
                      value={c.body}
                      onChange={(e) => updateComment(idx, 'body', e.target.value)}
                      rows={2}
                      style={{
                        width: '100%', boxSizing: 'border-box', resize: 'vertical',
                        background: surface.base, border: `1px solid ${border[0]}`, borderRadius: 3,
                        padding: '4px 6px', fontSize: 11, color: fg[0], outline: 'none', fontFamily: 'inherit',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '10px 16px', borderTop: `1px solid ${border[1]}`,
        }}>
          <button type="button" onClick={onCancel}
            style={{
              fontSize: 11, padding: '5px 12px', borderRadius: 5,
              border: `1px solid ${border[0]}`, background: surface.raised, color: fg[2], cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onPost({ summary, comments })}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 5,
              border: `1px solid ${accent.violet.border}`, background: accent.violet.subtle,
              color: accent.violet.fg, cursor: 'pointer',
            }}
          >
            <Send size={11} /> Post Review
          </button>
        </div>
      </div>
    </div>
  )
}
