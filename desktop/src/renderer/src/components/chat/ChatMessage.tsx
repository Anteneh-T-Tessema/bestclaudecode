import { useState, useCallback } from 'react'
import type { ChatMessage as ChatMessageType } from '../../store/useChatStore'
import { surface, border, fg, accent } from '../../design'
import { Bot, User, CheckCheck } from 'lucide-react'
import {
  parseEditBlocks,
  stripEditBlocks,
  parseRunBlocks,
  stripRunBlocks,
  parseBrowseBlocks,
  stripBrowseBlocks,
} from '../../lib/editBlocks'
import { EditProposalCard } from './EditProposalCard'
import { RunProposalCard } from './RunProposalCard'
import { BrowseProposalCard } from './BrowseProposalCard'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'

interface ChatMessageProps {
  message: ChatMessageType
  isStreaming?: boolean
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const editBlocks = isStreaming ? [] : parseEditBlocks(message.content)
  const runBlocks = isStreaming ? [] : parseRunBlocks(message.content)
  const browseBlocks = isStreaming ? [] : parseBrowseBlocks(message.content)

  const [groupAppliedPaths, setGroupAppliedPaths] = useState<Set<string>>(new Set())
  const [applyingAll, setApplyingAll] = useState(false)

  const projectPath = useSettingsStore((s) => s.projectPath)
  const openFile = useEditorStore((s) => s.openFile)
  const updateContent = useEditorStore((s) => s.updateContent)
  const tabs = useEditorStore((s) => s.tabs)

  const applyAll = useCallback(async () => {
    if (applyingAll) return
    setApplyingAll(true)

    const absPaths = editBlocks.map((b) =>
      b.path.startsWith('/') ? b.path : `${projectPath}/${b.path}`
    )

    // Capture originals for rollback
    const originals: string[] = await Promise.all(
      absPaths.map(async (p) => {
        try { return await window.api.fs.readFile(p) } catch { return '' }
      })
    )

    // Apply each block serially; track how many succeeded
    const applied: number[] = []
    let failedPath: string | null = null
    for (let i = 0; i < editBlocks.length; i++) {
      try {
        await window.api.fs.writeFile(absPaths[i], editBlocks[i].content)
        const openTab = tabs.find((t) => t.filePath === absPaths[i])
        if (openTab) {
          updateContent(openTab.id, editBlocks[i].content)
        } else {
          openFile(absPaths[i], editBlocks[i].content)
        }
        applied.push(i)
      } catch (err) {
        failedPath = editBlocks[i].path
        toast.error(`Apply All failed on ${editBlocks[i].path}: ${(err as Error).message}`)
        break
      }
    }

    if (failedPath !== null) {
      // Rollback all successful writes in reverse order
      const reverted: string[] = []
      for (let i = applied.length - 1; i >= 0; i--) {
        const idx = applied[i]
        try {
          await window.api.fs.writeFile(absPaths[idx], originals[idx])
          const openTab = tabs.find((t) => t.filePath === absPaths[idx])
          if (openTab) updateContent(openTab.id, originals[idx])
          reverted.push(editBlocks[idx].path)
        } catch { /* best effort */ }
      }
      if (reverted.length > 0) {
        toast.error(`Reverted: ${reverted.join(', ')}`)
      }
    } else {
      // All succeeded
      setGroupAppliedPaths(new Set(absPaths))
      toast.success(`${editBlocks.length} files updated`)
    }

    setApplyingAll(false)
  }, [applyingAll, editBlocks, projectPath, tabs, openFile, updateContent])
  let proseContent = message.content
  if (editBlocks.length > 0) proseContent = stripEditBlocks(proseContent)
  if (runBlocks.length > 0) proseContent = stripRunBlocks(proseContent)
  if (browseBlocks.length > 0) proseContent = stripBrowseBlocks(proseContent)

  // Simple markdown-ish rendering: code blocks, inline code, bold
  const renderContent = (text: string) => {
    // Split on code fences
    const parts = text.split(/(```[\s\S]*?```)/g)
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const match = part.match(/^```(\w+)?\n?([\s\S]*?)```$/)
        const code = match ? match[2] : part.slice(3, -3)
        return (
          <pre
            key={i}
            style={{
              background: surface.void,
              border: `1px solid ${border[1]}`,
              borderRadius: 6,
              padding: '10px 12px',
              margin: '8px 0',
              overflowX: 'auto',
              fontSize: 11,
              fontFamily: 'monospace',
              color: fg[0],
              whiteSpace: 'pre',
            }}
          >
            {code}
          </pre>
        )
      }
      // Inline code
      const inlineParts = part.split(/(`[^`]+`)/g)
      return (
        <span key={i}>
          {inlineParts.map((inline, j) => {
            if (inline.startsWith('`') && inline.endsWith('`')) {
              return (
                <code
                  key={j}
                  style={{
                    background: surface.raised,
                    borderRadius: 3,
                    padding: '1px 5px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: accent.cyan.fg,
                  }}
                >
                  {inline.slice(1, -1)}
                </code>
              )
            }
            return <span key={j}>{inline}</span>
          })}
        </span>
      )
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '12px 14px',
        borderBottom: `1px solid ${border[2]}`,
        background: isUser ? 'transparent' : surface.raised,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: isUser ? accent.blue.subtle : accent.violet.subtle,
          border: `1px solid ${isUser ? accent.blue.border : accent.violet.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {isUser ? (
          <User size={12} style={{ color: accent.blue.fg }} />
        ) : (
          <Bot size={12} style={{ color: accent.violet.fg }} />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: fg[2], marginBottom: 4 }}>
          {isUser ? 'You' : 'Assistant'}
        </div>
        <div style={{ fontSize: 13, color: fg[0], lineHeight: 1.55, wordBreak: 'break-word' }}>
          {renderContent(proseContent)}
          {editBlocks.length > 1 && groupAppliedPaths.size === 0 && (
            <div style={{ margin: '8px 0 4px' }}>
              <button
                type="button"
                onClick={applyAll}
                disabled={applyingAll}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: applyingAll ? surface.raised : accent.green.fg,
                  border: 'none', borderRadius: 5,
                  padding: '5px 14px', fontSize: 11, fontWeight: 700,
                  color: applyingAll ? fg[2] : '#06150c',
                  cursor: applyingAll ? 'not-allowed' : 'pointer',
                }}
              >
                <CheckCheck size={12} />
                {applyingAll ? 'Applying…' : `Apply All ${editBlocks.length} files`}
              </button>
            </div>
          )}
          {editBlocks.map((block, i) => {
            const absPath = block.path.startsWith('/') ? block.path : `${projectPath}/${block.path}`
            return (
              <EditProposalCard
                key={`${block.path}-${i}`}
                block={block}
                isGroupApplied={groupAppliedPaths.has(absPath)}
                onApply={() => {
                  // Individual apply: mark this path as group-applied for display consistency
                  setGroupAppliedPaths((prev) => new Set([...prev, absPath]))
                }}
              />
            )
          })}
          {runBlocks.map((block, i) => (
            <RunProposalCard key={`run-${i}-${block.command}`} block={block} />
          ))}
          {browseBlocks.map((block, i) => (
            <BrowseProposalCard key={`browse-${i}-${block.url}`} block={block} />
          ))}
          {isStreaming && (
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 13,
                background: accent.violet.fg,
                borderRadius: 2,
                marginLeft: 2,
                animation: 'pulse 1s ease-in-out infinite',
                verticalAlign: 'text-bottom',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
