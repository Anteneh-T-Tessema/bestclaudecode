import { useRef, useEffect, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ModelSelector } from './ModelSelector'
import { surface, border, fg, accent } from '../../design'
import { Trash2, FlaskConical, Loader2, RotateCcw, Plus, X, Zap } from 'lucide-react'

export function ChatPanel() {
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const createSession = useChatStore((s) => s.createSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const switchSession = useChatStore((s) => s.switchSession)
  const streamingId = useChatStore((s) => s.streamingId)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const composerMode = useChatStore((s) => s.composerMode)
  const setComposerMode = useChatStore((s) => s.setComposerMode)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const startAssistantMessage = useChatStore((s) => s.startAssistantMessage)
  const appendDelta = useChatStore((s) => s.appendDelta)
  const finalizeMessage = useChatStore((s) => s.finalizeMessage)

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages ?? []

  const scrollRef = useRef<HTMLDivElement>(null)
  const [runningTests, setRunningTests] = useState(false)

  const regenerate = () => {
    if (streamingId !== null) return
    const { sessions: ss, activeSessionId: aid } = useChatStore.getState()
    const sess = ss.find((s) => s.id === aid)
    if (!sess?.messages.length) return
    let stripped = sess.messages
    if (stripped[stripped.length - 1]?.role === 'assistant') stripped = stripped.slice(0, -1)
    const lastUser = [...stripped].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    useChatStore.setState({
      sessions: ss.map((s) => s.id === aid ? { ...s, messages: stripped } : s),
    })
    window.dispatchEvent(new CustomEvent('lakoora:chat:regenerate', { detail: { content: lastUser.content } }))
  }

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
          onClick={regenerate}
          disabled={streamingId !== null || messages.length === 0}
          title="Regenerate last response"
          style={{
            background: 'none',
            border: 'none',
            cursor: streamingId !== null || messages.length === 0 ? 'default' : 'pointer',
            color: streamingId !== null || messages.length === 0 ? fg[4] : fg[3],
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <RotateCcw size={13} />
        </button>

        <button
          type="button"
          onClick={() => createSession()}
          title="New chat session"
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
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={() => setComposerMode(!composerMode)}
          title={composerMode ? 'Composer mode: edits auto-apply (click to disable)' : 'Enable Composer mode — edits apply automatically'}
          style={{
            background: composerMode ? accent.violet.subtle : 'none',
            border: composerMode ? `1px solid ${accent.violet.border}` : 'none',
            borderRadius: 4,
            cursor: 'pointer',
            color: composerMode ? accent.violet.fg : fg[3],
            padding: '2px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 9,
            fontWeight: composerMode ? 700 : 400,
          }}
        >
          <Zap size={11} />
          {composerMode && 'Auto'}
        </button>
        <button
          type="button"
          onClick={clearMessages}
          title="Clear current session"
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

      {/* Session tabs */}
      {sessions.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: `1px solid ${border[1]}`,
            background: surface.void,
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {sessions.map((sess) => {
            const isActive = sess.id === activeSessionId
            return (
              <div
                key={sess.id}
                onClick={() => switchSession(sess.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px 4px 10px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  maxWidth: 140,
                  borderRight: `1px solid ${border[2]}`,
                  borderBottom: isActive ? `2px solid ${accent.violet.fg}` : '2px solid transparent',
                  background: isActive ? surface.surface : 'transparent',
                }}
              >
                <span style={{
                  fontSize: 10,
                  color: isActive ? fg[0] : fg[3],
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {sess.title}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteSession(sess.id) }}
                  title="Close session"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: fg[4],
                    padding: 1,
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <X size={9} />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => createSession()}
            title="New chat session"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: fg[3],
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Plus size={11} />
          </button>
        </div>
      )}

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
