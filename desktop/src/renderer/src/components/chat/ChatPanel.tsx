import { useRef, useEffect, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ModelSelector } from './ModelSelector'
import { surface, border, fg, accent } from '../../design'
import { Trash2, FlaskConical, Loader2 } from 'lucide-react'

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages)
  const streamingId = useChatStore((s) => s.streamingId)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const startAssistantMessage = useChatStore((s) => s.startAssistantMessage)
  const appendDelta = useChatStore((s) => s.appendDelta)
  const finalizeMessage = useChatStore((s) => s.finalizeMessage)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [runningTests, setRunningTests] = useState(false)

  const runTests = async () => {
    setRunningTests(true)
    addUserMessage('Run the test suite')
    const id = startAssistantMessage()
    try {
      const result = await window.api.settings.runTests()
      const status = result.exitCode === 0 ? 'PASSED' : `FAILED (exit code ${result.exitCode})`
      const output = (result.stdout + result.stderr).trim().slice(-4000)
      appendDelta(id, `**Test run: ${status}**\n\n\`\`\`\n${output}\n\`\`\``)
    } catch (err) {
      appendDelta(id, `Failed to run tests: ${(err as Error).message}`)
    } finally {
      finalizeMessage(id)
      setRunningTests(false)
    }
  }

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, streamingId])

  // E2E test harness: synthetic message injection and clear for Playwright specs.
  // These events only fire when a test explicitly dispatches them — harmless in production.
  useEffect(() => {
    const injectHandler = (e: Event) => {
      const { role, content } = (e as CustomEvent<{ role: string; content: string }>).detail
      if (role === 'assistant') {
        const id = startAssistantMessage()
        appendDelta(id, content)
        finalizeMessage(id)
      } else {
        addUserMessage(content)
      }
    }
    const clearHandler = () => clearMessages()
    window.addEventListener('lakoora:e2e:injectMessage', injectHandler)
    window.addEventListener('lakoora:e2e:clearMessages', clearHandler)
    return () => {
      window.removeEventListener('lakoora:e2e:injectMessage', injectHandler)
      window.removeEventListener('lakoora:e2e:clearMessages', clearHandler)
    }
  }, [addUserMessage, startAssistantMessage, appendDelta, finalizeMessage, clearMessages])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          height: 42,
          borderBottom: `1px solid ${border[1]}`,
          background: surface.surface,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: fg[0], flex: 1 }}>AI CHAT</span>

        <ModelSelector />

        <button
          type="button"
          onClick={runTests}
          disabled={runningTests}
          title="Run pytest and post the result to chat"
          style={{
            background: 'none',
            border: 'none',
            cursor: runningTests ? 'default' : 'pointer',
            color: runningTests ? fg[4] : fg[3],
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {runningTests ? (
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <FlaskConical size={13} />
          )}
        </button>

        <button
          type="button"
          onClick={clearMessages}
          title="Clear conversation"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: fg[3],
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {messages.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: 24,
              gap: 8,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: accent.violet.subtle,
                border: `1px solid ${accent.violet.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M8 0 L15 3 V8 C15 12 12 15 8 16 C4 15 1 12 1 8 V3 Z" fill={accent.green.fg} opacity="0.85" />
              </svg>
            </div>
            <p style={{ color: fg[2], fontSize: 12, textAlign: 'center', maxWidth: 200 }}>
              Ask Lakoora anything about your code. Use @file to share the current editor context.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              isStreaming={msg.id === streamingId}
            />
          ))
        )}
      </div>

      {/* Input */}
      <ChatInput />
    </div>
  )
}
