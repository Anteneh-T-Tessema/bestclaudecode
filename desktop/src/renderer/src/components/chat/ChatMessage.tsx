import { useState } from 'react'
import type { ChatMessage as ChatMessageType } from '../../store/useChatStore'
import { surface, border, fg, accent } from '../../design'
import { Bot, User, Copy, Check } from 'lucide-react'
import {
  parseEditBlocks,
  stripEditBlocks,
  parseRunBlocks,
  stripRunBlocks,
  parseBrowseBlocks,
  stripBrowseBlocks,
} from '../../lib/editBlocks'
import { EditProposalCard } from './EditProposalCard'
import { MultiFileEditCard } from './MultiFileEditCard'
import { RunProposalCard } from './RunProposalCard'
import { BrowseProposalCard } from './BrowseProposalCard'


interface ChatMessageProps {
  message: ChatMessageType
  isStreaming?: boolean
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  const copyToClipboard = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const editBlocks = isStreaming ? [] : parseEditBlocks(message.content)
  const runBlocks = isStreaming ? [] : parseRunBlocks(message.content)
  const browseBlocks = isStreaming ? [] : parseBrowseBlocks(message.content)

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        gap: 10,
        padding: '12px 14px',
        borderBottom: `1px solid ${border[2]}`,
        background: isUser ? 'transparent' : surface.raised,
        position: 'relative',
      }}
    >
      {hovered && !isStreaming && (
        <button
          type="button"
          onClick={copyToClipboard}
          title="Copy message"
          style={{
            position: 'absolute',
            top: 6,
            right: 8,
            background: surface.overlay,
            border: `1px solid ${border[1]}`,
            borderRadius: 4,
            padding: '2px 6px',
            cursor: 'pointer',
            color: copied ? accent.green.fg : fg[3],
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}
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
          {editBlocks.length > 1 ? (
            <MultiFileEditCard blocks={editBlocks} />
          ) : editBlocks.length === 1 ? (
            <EditProposalCard
              block={editBlocks[0]}
              onApply={() => {}}
            />
          ) : null}
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
