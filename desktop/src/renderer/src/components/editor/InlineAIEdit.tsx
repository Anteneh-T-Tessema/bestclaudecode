import { useState, useRef, useEffect } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { useEditorActionsStore } from '../../store/useEditorActionsStore'
import { useEditorStore } from '../../store/useEditorStore'
import { useChatStore } from '../../store/useChatStore'
import { toast } from '../../store/useToastStore'
import { surface, border, fg, accent } from '../../design'
import { Loader2, X, Wand2, Check, RotateCcw } from 'lucide-react'

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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runGenerate = async () => {
    if (!instruction.trim() || !inlineEditTarget || !activeTabId || !tab) return
    setPhase('loading')
    try {
      const systemPrompt = `You are an expert code editor. The user will provide a code snippet and an instruction. Return ONLY the edited code with no explanation, no markdown fences, no extra text.`
      const userMessage = `Code to edit:\n\`\`\`\n${inlineEditTarget.selectedText}\n\`\`\`\n\nInstruction: ${instruction}`

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

      setResult(accumulated.trim())
      setPhase('review')
    } catch (err) {
      toast.error(`AI edit failed: ${(err as Error).message}`)
      setPhase('input')
    }
  }

  const accept = () => {
    if (!inlineEditTarget || !activeTabId || !tab) return
    const lines = tab.content.split('\n')
    const before = lines.slice(0, inlineEditTarget.startLine - 1)
    const after = lines.slice(inlineEditTarget.endLine)
    const newContent = [...before, result, ...after].join('\n')
    updateContent(activeTabId, newContent)
    toast.success('AI edit applied')
    closeInlineEdit()
  }

  const discard = () => {
    setPhase('input')
    setResult('')
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
          <span style={{ fontSize: 12, fontWeight: 600, color: fg[0] }}>AI Edit</span>
          <span style={{ fontSize: 11, color: fg[3], marginLeft: 4 }}>
            Lines {inlineEditTarget.startLine}–{inlineEditTarget.endLine}
          </span>
          {reviewing && (
            <span style={{ fontSize: 10, color: accent.amber.fg, marginLeft: 4 }}>Review before applying</span>
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
            {/* Selected code preview */}
            <div
              style={{
                padding: '10px 14px',
                borderBottom: `1px solid ${border[2]}`,
                background: surface.base,
                maxHeight: 120,
                overflow: 'auto',
              }}
            >
              <pre style={{ margin: 0, fontSize: 11, color: fg[2], fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {inlineEditTarget.selectedText.slice(0, 400)}
                {inlineEditTarget.selectedText.length > 400 ? '…' : ''}
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
            <div style={{ height: 340 }}>
              <DiffEditor
                original={inlineEditTarget.selectedText}
                modified={result}
                language={tab?.language}
                theme="lakoora-dark"
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  fontSize: 12,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 8,
                padding: '10px 14px',
                borderTop: `1px solid ${border[1]}`,
              }}
            >
              <button
                type="button"
                onClick={discard}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: `1px solid ${border[0]}`,
                  borderRadius: 6,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: fg[2],
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={12} />
                Discard
              </button>
              <button
                type="button"
                onClick={accept}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: accent.green.fg,
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 16px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#06150c',
                  cursor: 'pointer',
                }}
              >
                <Check size={12} />
                Accept
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
