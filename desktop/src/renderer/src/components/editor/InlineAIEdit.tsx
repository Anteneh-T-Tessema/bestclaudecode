import { useState, useRef, useEffect, useCallback } from 'react'
import { useEditorActionsStore } from '../../store/useEditorActionsStore'
import { useEditorStore } from '../../store/useEditorStore'
import { useChatStore } from '../../store/useChatStore'
import { toast } from '../../store/useToastStore'
import { surface, border, fg, accent } from '../../design'
import { Loader2, X, Wand2, Check, RotateCcw, CheckCheck, XSquare } from 'lucide-react'
import { diffLines, buildHunks, applyHunks, HunkCard, type Hunk } from '../../lib/hunkDiff'

type Phase = 'input' | 'loading' | 'review'

export function InlineAIEdit() {
  const { inlineEditTarget, closeInlineEdit } = useEditorActionsStore()
  const updateContent = useEditorStore((s) => s.updateContent)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const activeModel = useChatStore((s) => s.activeModel)
  const tabs = useEditorStore((s) => s.tabs)
  const tab = tabs.find((t) => t.id === activeTabId)

  const [instruction, setInstruction] = useState('')
  const [phase, setPhase] = useState<Phase>('input')
  const [result, setResult] = useState('')
  const [hunks, setHunks] = useState<Hunk[]>([])
  const [acceptedIds, setAcceptedIds] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const isGenerateMode = inlineEditTarget?.selectedText === ''

  const toggleHunk = useCallback((id: number) => {
    setAcceptedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const acceptAll = useCallback(() => setAcceptedIds(new Set(hunks.map((h) => h.id))), [hunks])
  const rejectAll = useCallback(() => setAcceptedIds(new Set()), [])

  const acceptedCount = acceptedIds.size

  const runGenerate = async () => {
    if (!instruction.trim() || !inlineEditTarget || !activeTabId || !tab) return
    setPhase('loading')
    try {
      const systemPrompt = isGenerateMode
        ? `You are an expert code editor. Generate code to insert at the cursor position based on the user's instruction and the surrounding context. Return ONLY the new code with no explanation, no markdown fences, no extra text.`
        : `You are an expert code editor. The user will provide a code snippet and an instruction. Return ONLY the edited code with no explanation, no markdown fences, no extra text.`

      const contextLines = isGenerateMode
        ? tab.content.split('\n').slice(0, inlineEditTarget.startLine).slice(-15).join('\n')
        : ''

      const userMessage = isGenerateMode
        ? `File: ${tab.filePath}\n\nContext above cursor:\n\`\`\`\n${contextLines}\n\`\`\`\n\nInstruction: ${instruction}`
        : `Code to edit:\n\`\`\`\n${inlineEditTarget.selectedText}\n\`\`\`\n\nInstruction: ${instruction}`

      const streamId = await window.api.ai.streamChat({
        messages: [{ role: 'user', content: userMessage }],
        model: activeModel,
        systemPrompt,
      })

      let accumulated = ''
      await new Promise<void>((resolve, reject) => {
        const unChunk = window.api.ai.onChunk(streamId, (delta) => {
          accumulated += delta
        })
        const unDone = window.api.ai.onDone(streamId, () => {
          unChunk()
          unDone()
          resolve()
        })
        const unError = window.api.ai.onError(streamId, (err) => {
          unChunk()
          unDone()
          unError()
          reject(new Error(err))
        })
      })

      const trimmed = accumulated.trim()
      setResult(trimmed)
      if (!isGenerateMode && inlineEditTarget) {
        const h = buildHunks(diffLines(inlineEditTarget.selectedText, trimmed))
        setHunks(h)
        setAcceptedIds(new Set(h.map((hk) => hk.id)))
      }
      setPhase('review')
    } catch (err) {
      toast.error(`AI edit failed: ${(err as Error).message}`)
      setPhase('input')
    }
  }

  const accept = () => {
    if (!inlineEditTarget || !activeTabId || !tab) return
    const fileLines = tab.content.split('\n')
    let newContent: string
    if (isGenerateMode) {
      const before = fileLines.slice(0, inlineEditTarget.startLine)
      const after = fileLines.slice(inlineEditTarget.startLine)
      newContent = [...before, result, ...after].join('\n')
    } else {
      const partialResult = hunks.length > 0
        ? applyHunks(inlineEditTarget.selectedText, hunks, acceptedIds)
        : result
      const before = fileLines.slice(0, inlineEditTarget.startLine - 1)
      const after = fileLines.slice(inlineEditTarget.endLine)
      newContent = [...before, partialResult, ...after].join('\n')
    }
    updateContent(activeTabId, newContent)
    const acceptedHunks = acceptedIds.size
    const totalHunks = hunks.length
    toast.success(
      isGenerateMode
        ? 'Code generated'
        : totalHunks > 0
          ? `Applied ${acceptedHunks}/${totalHunks} hunk${totalHunks !== 1 ? 's' : ''}`
          : 'AI edit applied'
    )
    closeInlineEdit()
  }

  const discard = () => {
    setPhase('input')
    setResult('')
    setHunks([])
    setAcceptedIds(new Set())
  }

  if (!inlineEditTarget) return null

  const loading = phase === 'loading'
  const reviewing = phase === 'review'

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 60,
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeInlineEdit()
      }}
    >
      <div
        style={{
          width: reviewing ? 760 : 520,
          background: surface.overlay,
          border: `1px solid ${border[0]}`,
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: `1px solid ${border[1]}`,
          }}
        >
          <Wand2 size={14} style={{ color: accent.violet.fg }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: fg[0] }}>
            {isGenerateMode ? 'AI Generate' : 'AI Edit'}
          </span>
          <span style={{ fontSize: 11, color: fg[3], marginLeft: 4 }}>
            {isGenerateMode ? `Line ${inlineEditTarget.startLine}` : `Lines ${inlineEditTarget.startLine}–${inlineEditTarget.endLine}`}
          </span>
          {reviewing && (
            <span style={{ fontSize: 10, color: accent.amber.fg, marginLeft: 4 }}>
              {isGenerateMode ? 'Insert after line' : 'Review before applying'}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeInlineEdit}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], padding: 2 }}
          >
            <X size={14} />
          </button>
        </div>

        {!reviewing && (
          <>
            {/* Selected code / context preview */}
            <div
              style={{
                padding: '10px 14px',
                borderBottom: `1px solid ${border[2]}`,
                background: surface.base,
                maxHeight: 120,
                overflow: 'auto',
              }}
            >
              {isGenerateMode ? (
                <div style={{ fontSize: 10, color: fg[4], marginBottom: 4 }}>Context above cursor (last 15 lines)</div>
              ) : null}
              <pre style={{ margin: 0, fontSize: 11, color: fg[2], fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {isGenerateMode
                  ? tab?.content.split('\n').slice(0, inlineEditTarget.startLine).slice(-15).join('\n')
                  : inlineEditTarget.selectedText.slice(0, 400) + (inlineEditTarget.selectedText.length > 400 ? '…' : '')
                }
              </pre>
            </div>

            {/* Instruction input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px' }}>
              <input
                ref={inputRef}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    runGenerate()
                  }
                  if (e.key === 'Escape') closeInlineEdit()
                }}
                placeholder="Instruction (e.g. add error handling, refactor to async/await)…"
                disabled={loading}
                style={{
                  flex: 1,
                  background: surface.raised,
                  border: `1px solid ${border[0]}`,
                  borderRadius: 6,
                  padding: '7px 10px',
                  fontSize: 13,
                  color: fg[0],
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={runGenerate}
                disabled={loading || !instruction.trim()}
                style={{
                  background: accent.violet.fg,
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#fff',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading || !instruction.trim() ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {loading && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                {loading ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </>
        )}

        {reviewing && (
          <>
            {/* Per-hunk diff view (generate mode falls back to plain result) */}
            {isGenerateMode ? (
              <div style={{ maxHeight: 340, overflow: 'auto', background: surface.base }}>
                <pre style={{ margin: 0, padding: '10px 14px', fontSize: 11, color: fg[1], fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                  {result}
                </pre>
              </div>
            ) : (
              <>
                {/* Hunk toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderBottom: `1px solid ${border[2]}`, background: surface.base }}>
                  <span style={{ fontSize: 11, color: fg[3] }}>
                    {hunks.length === 0 ? 'No changes' : `${acceptedCount}/${hunks.length} hunk${hunks.length !== 1 ? 's' : ''} accepted`}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button type="button" onClick={acceptAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: accent.green.fg, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <CheckCheck size={11} /> Accept all
                  </button>
                  <button type="button" onClick={rejectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: fg[3], display: 'flex', alignItems: 'center', gap: 3 }}>
                    <XSquare size={11} /> Reject all
                  </button>
                </div>
                {/* Hunk list */}
                <div style={{ maxHeight: 300, overflowY: 'auto', background: surface.surface }}>
                  {hunks.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: 11, color: fg[3] }}>No differences found.</div>
                  ) : (
                    hunks.map((h) => (
                      <HunkCard key={h.id} hunk={h} accepted={acceptedIds.has(h.id)} onToggle={() => toggleHunk(h.id)} />
                    ))
                  )}
                </div>
              </>
            )}
            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '10px 14px', borderTop: `1px solid ${border[1]}` }}>
              <button
                type="button"
                onClick={discard}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${border[0]}`, borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, color: fg[2], cursor: 'pointer' }}
              >
                <RotateCcw size={12} />
                Discard
              </button>
              <button
                type="button"
                onClick={accept}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: accent.green.fg, border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 700, color: '#06150c', cursor: 'pointer' }}
              >
                <Check size={12} />
                {isGenerateMode ? 'Insert' : acceptedCount === hunks.length ? 'Accept All' : `Apply ${acceptedCount} hunk${acceptedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
