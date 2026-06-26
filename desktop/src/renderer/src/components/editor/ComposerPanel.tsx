import { useState, useRef, useCallback } from 'react'
import { X, Plus, FileText, Code2, GitCompare, MousePointer } from 'lucide-react'
import { useComposerStore, type ComposerContextItem } from '../../store/useComposerStore'
import { accent, border, fg, surface } from '../../design'
import { useEditorStore } from '../../store/useEditorStore'

function ContextPill({ item, onRemove }: { item: ComposerContextItem; onRemove: () => void }) {
  const iconColor = item.type === 'file' ? accent.cyan.fg
    : item.type === 'symbol' ? accent.violet.fg
    : item.type === 'diff' ? accent.amber.fg
    : fg[3]

  const label = item.type === 'file' ? `@file ${item.value}`
    : item.type === 'symbol' ? `@symbol ${item.value}`
    : item.type === 'diff' ? '@diff'
    : `@selection`

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: surface.void, border: `1px solid ${border[0]}`,
      borderRadius: 12, padding: '2px 8px 2px 6px',
      fontSize: 10, color: iconColor, fontFamily: 'monospace',
      maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      <span style={{ flexShrink: 0 }}>{label.slice(0, 40)}{label.length > 40 ? '…' : ''}</span>
      <button
        type="button"
        onClick={onRemove}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: fg[4], display: 'flex', alignItems: 'center', flexShrink: 0,
        }}
        title="Remove"
      >
        <X size={9} />
      </button>
    </span>
  )
}

export function ComposerPanel() {
  const { isOpen, contextItems, close, addContext, removeContext, clearContext } = useComposerStore()
  const getActiveTab = useEditorStore((s) => s.getActiveTab)
  const editorSelection = useEditorStore((s) => s.editorSelection)

  const [instruction, setInstruction] = useState('')
  const [fileInput, setFileInput] = useState('')
  const [symbolInput, setSymbolInput] = useState('')
  const [addMode, setAddMode] = useState<'file' | 'symbol' | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    if (!instruction.trim() && contextItems.length === 0) return

    const parts: string[] = []
    for (const item of contextItems) {
      if (item.type === 'file') parts.push(`@file ${item.value}`)
      else if (item.type === 'symbol') parts.push(`@symbol ${item.value}`)
      else if (item.type === 'diff') parts.push('@diff')
      else if (item.type === 'selection') parts.push(`@selection`)
    }
    const message = parts.length > 0
      ? `${parts.join(' ')}\n\n${instruction.trim()}`
      : instruction.trim()

    window.dispatchEvent(new CustomEvent('meshflow:composer:send', { detail: { message } }))
    setInstruction('')
    clearContext()
    close()
  }, [instruction, contextItems, clearContext, close])

  const addFileContext = useCallback(() => {
    if (!fileInput.trim()) return
    addContext({ type: 'file', value: fileInput.trim() })
    setFileInput('')
    setAddMode(null)
  }, [fileInput, addContext])

  const addSymbolContext = useCallback(() => {
    if (!symbolInput.trim()) return
    addContext({ type: 'symbol', value: symbolInput.trim() })
    setSymbolInput('')
    setAddMode(null)
  }, [symbolInput, addContext])

  const addDiff = useCallback(() => {
    if (!contextItems.find((i) => i.type === 'diff')) {
      addContext({ type: 'diff', value: '@diff' })
    }
  }, [contextItems, addContext])

  const addSelection = useCallback(() => {
    const sel = editorSelection
    if (sel && !contextItems.find((i) => i.type === 'selection')) {
      addContext({ type: 'selection', value: sel.slice(0, 200) })
    }
  }, [editorSelection, contextItems, addContext])

  // Auto-add the current open file as context on open
  const activeTab = getActiveTab()

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 24,
        width: 380,
        maxHeight: 520,
        zIndex: 1000,
        background: surface.surface,
        border: `1px solid ${border[0]}`,
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: `1px solid ${border[1]}`,
        background: surface.raised, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Code2 size={13} color={accent.violet.fg} />
          <span style={{ fontSize: 12, fontWeight: 700, color: fg[0] }}>Composer</span>
          <span style={{ fontSize: 9, color: fg[4], marginLeft: 2 }}>Cmd+I</span>
        </div>
        <button
          type="button"
          onClick={close}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], display: 'flex', alignItems: 'center' }}
          title="Close composer"
        >
          <X size={13} />
        </button>
      </div>

      {/* Context items */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${border[2]}`, flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: fg[4], fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>
          Context
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 22 }}>
          {activeTab && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: `${accent.blue.fg}15`, border: `1px solid ${accent.blue.border}`,
              borderRadius: 12, padding: '2px 8px',
              fontSize: 10, color: accent.blue.fg, fontFamily: 'monospace',
            }}>
              <FileText size={9} /> {activeTab.label}
            </span>
          )}
          {contextItems.map((item, i) => (
            <ContextPill key={i} item={item} onRemove={() => removeContext(i)} />
          ))}
        </div>

        {/* Add context buttons */}
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setAddMode(addMode === 'file' ? null : 'file')}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 9, padding: '3px 7px', borderRadius: 4,
              background: addMode === 'file' ? accent.cyan.subtle : surface.raised,
              border: `1px solid ${addMode === 'file' ? accent.cyan.border : border[0]}`,
              color: addMode === 'file' ? accent.cyan.fg : fg[3],
              cursor: 'pointer',
            }}
          >
            <Plus size={9} /> File
          </button>
          <button
            type="button"
            onClick={() => setAddMode(addMode === 'symbol' ? null : 'symbol')}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 9, padding: '3px 7px', borderRadius: 4,
              background: addMode === 'symbol' ? accent.violet.subtle : surface.raised,
              border: `1px solid ${addMode === 'symbol' ? accent.violet.border : border[0]}`,
              color: addMode === 'symbol' ? accent.violet.fg : fg[3],
              cursor: 'pointer',
            }}
          >
            <Plus size={9} /> Symbol
          </button>
          <button
            type="button"
            onClick={addDiff}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 9, padding: '3px 7px', borderRadius: 4,
              background: surface.raised, border: `1px solid ${border[0]}`,
              color: fg[3], cursor: 'pointer',
            }}
          >
            <GitCompare size={9} /> Diff
          </button>
          {editorSelection && (
            <button
              type="button"
              onClick={addSelection}
              style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 9, padding: '3px 7px', borderRadius: 4,
                background: surface.raised, border: `1px solid ${border[0]}`,
                color: fg[3], cursor: 'pointer',
              }}
            >
              <MousePointer size={9} /> Selection
            </button>
          )}
        </div>

        {/* File path input */}
        {addMode === 'file' && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <input
              autoFocus
              value={fileInput}
              onChange={(e) => setFileInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addFileContext(); if (e.key === 'Escape') setAddMode(null) }}
              placeholder="Relative file path…"
              style={{
                flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                borderRadius: 4, padding: '4px 7px', fontSize: 10, color: fg[0],
                outline: 'none', fontFamily: 'monospace',
              }}
            />
            <button type="button" onClick={addFileContext} style={{
              fontSize: 9, padding: '4px 8px', borderRadius: 4,
              background: accent.cyan.fg, border: 'none', color: '#000', cursor: 'pointer',
            }}>Add</button>
          </div>
        )}

        {/* Symbol name input */}
        {addMode === 'symbol' && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <input
              autoFocus
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSymbolContext(); if (e.key === 'Escape') setAddMode(null) }}
              placeholder="Function or class name…"
              style={{
                flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                borderRadius: 4, padding: '4px 7px', fontSize: 10, color: fg[0],
                outline: 'none', fontFamily: 'monospace',
              }}
            />
            <button type="button" onClick={addSymbolContext} style={{
              fontSize: 9, padding: '4px 8px', borderRadius: 4,
              background: accent.violet.fg, border: 'none', color: '#fff', cursor: 'pointer',
            }}>Add</button>
          </div>
        )}
      </div>

      {/* Instruction textarea */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 12px', gap: 8, overflow: 'hidden' }}>
        <div style={{ fontSize: 9, color: fg[4], fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Instruction
        </div>
        <textarea
          ref={textareaRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend() }}
          placeholder="Describe the change you want to make… (Cmd+Enter to send)"
          style={{
            flex: 1,
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 12,
            color: fg[0],
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            minHeight: 100,
          }}
        />
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        padding: '8px 12px', borderTop: `1px solid ${border[1]}`,
        background: surface.raised, flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, color: fg[4] }}>Cmd+Enter to send</span>
        <button
          type="button"
          onClick={handleSend}
          disabled={!instruction.trim() && contextItems.length === 0}
          style={{
            fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 6,
            background: (instruction.trim() || contextItems.length > 0) ? accent.violet.fg : surface.raised,
            border: 'none',
            color: (instruction.trim() || contextItems.length > 0) ? '#fff' : fg[4],
            cursor: (instruction.trim() || contextItems.length > 0) ? 'pointer' : 'not-allowed',
          }}
        >
          Send to Chat
        </button>
      </div>
    </div>
  )
}
