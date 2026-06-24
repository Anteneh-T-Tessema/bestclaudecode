import { useRef, useEffect, useState, useMemo } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { useUsageStore } from '../../store/useUsageStore'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ModelSelector } from './ModelSelector'
import { surface, border, fg, accent } from '../../design'
import { Trash2, FlaskConical, Loader2, RotateCcw, Plus, X, Zap, Search, Download } from 'lucide-react'
import { toast } from '../../store/useToastStore'
import { estimateCostUsd } from '../../modelRates'

interface HistoryMatch {
  sessionId: string
  sessionTitle: string
  messageId: string
  role: 'user' | 'assistant'
  snippet: string
  timestamp: number
}

function buildSnippet(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return content.slice(0, 100)
  const start = Math.max(0, idx - 40)
  const end = Math.min(content.length, idx + query.length + 40)
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '')
}

function sessionToMarkdown(session: { title: string; messages: { role: string; content: string; timestamp: number }[] }): string {
  const lines = [`# ${session.title}`, '']
  for (const m of session.messages) {
    const who = m.role === 'user' ? 'You' : 'Assistant'
    lines.push(`### ${who} — ${new Date(m.timestamp).toLocaleString()}`, '', m.content, '')
  }
  return lines.join('\n')
}

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
  const addSessionUsage = useChatStore((s) => s.addSessionUsage)

  const addUsage = useUsageStore((s) => s.addUsage)
  const resetSession = useUsageStore((s) => s.resetSession)
  const sessionInputTokens = useUsageStore((s) => s.sessionInputTokens)
  const sessionOutputTokens = useUsageStore((s) => s.sessionOutputTokens)
  const sessionCostUsd = useUsageStore((s) => s.sessionCostUsd)

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const messages = activeSession?.messages ?? []

  const scrollRef = useRef<HTMLDivElement>(null)
  const [runningTests, setRunningTests] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')

  const historyMatches = useMemo<HistoryMatch[]>(() => {
    const q = historyQuery.trim().toLowerCase()
    if (!q) return []
    const matches: HistoryMatch[] = []
    for (const sess of sessions) {
      for (const msg of sess.messages) {
        if (msg.content.toLowerCase().includes(q)) {
          matches.push({
            sessionId: sess.id,
            sessionTitle: sess.title,
            messageId: msg.id,
            role: msg.role,
            snippet: buildSnippet(msg.content, q),
            timestamp: msg.timestamp,
          })
        }
      }
    }
    return matches.sort((a, b) => b.timestamp - a.timestamp).slice(0, 40)
  }, [historyQuery, sessions])

  const jumpToMatch = (m: HistoryMatch) => {
    switchSession(m.sessionId)
    setHistoryOpen(false)
    setHistoryQuery('')
  }

  const exportSession = async () => {
    if (!activeSession) return
    const markdown = sessionToMarkdown(activeSession)
    const safeTitle = activeSession.title.replace(/[^\w\- ]/g, '').trim() || 'chat'
    const path = await window.api.ai.exportChat({ markdown, defaultFilename: `${safeTitle}.md` })
    if (path) toast.success(`Exported to ${path}`)
  }

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

  // Gap 47 — reset token counter when the user switches to a different chat session.
  useEffect(() => { resetSession() }, [activeSessionId, resetSession])

  // Subscribe to ai:usage events and accumulate session token counts — both the
  // live in-memory display (addUsage) and the persisted per-session record used
  // by the usage dashboard (Gap 56, addSessionUsage).
  useEffect(() => {
    return window.api.ai.onUsage(({ inputTokens, outputTokens, model }) => {
      addUsage(inputTokens, outputTokens, model)
      const { activeSessionId: sid } = useChatStore.getState()
      addSessionUsage(sid, inputTokens, outputTokens, estimateCostUsd(model, inputTokens, outputTokens), model)
    })
  }, [addUsage, addSessionUsage])

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
          position: 'relative',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: fg[0], flex: 1 }}>AI CHAT</span>

        {(sessionInputTokens > 0 || sessionOutputTokens > 0) && (
          <span title={`Tokens this session: ${sessionInputTokens.toLocaleString()} in / ${sessionOutputTokens.toLocaleString()} out${sessionCostUsd > 0 ? ` (~$${sessionCostUsd.toFixed(4)})` : ''}`} style={{
            fontSize: 9, color: fg[4], fontFamily: 'monospace', padding: '1px 5px',
            borderRadius: 3, background: surface.raised, border: `1px solid ${border[1]}`,
            cursor: 'default', flexShrink: 0,
          }}>
            {sessionInputTokens > 999 ? `${(sessionInputTokens / 1000).toFixed(1)}k` : sessionInputTokens}↑{' '}
            {sessionOutputTokens > 999 ? `${(sessionOutputTokens / 1000).toFixed(1)}k` : sessionOutputTokens}↓
            {sessionCostUsd > 0 && ` $${sessionCostUsd < 0.01 ? sessionCostUsd.toFixed(4) : sessionCostUsd.toFixed(2)}`}
          </span>
        )}

        <ModelSelector />

        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          title="Search chat history"
          style={{
            background: historyOpen ? surface.raised : 'none',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            color: historyOpen ? fg[0] : fg[3],
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Search size={13} />
        </button>

        <button
          type="button"
          onClick={exportSession}
          disabled={messages.length === 0}
          title="Export current session to Markdown"
          style={{
            background: 'none',
            border: 'none',
            cursor: messages.length === 0 ? 'default' : 'pointer',
            color: messages.length === 0 ? fg[4] : fg[3],
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Download size={13} />
        </button>

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

        {/* History search overlay */}
        {historyOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 8,
              right: 8,
              marginTop: 4,
              background: surface.overlay,
              border: `1px solid ${border[0]}`,
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              zIndex: 50,
              overflow: 'hidden',
            }}
          >
            <input
              autoFocus
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setHistoryOpen(false) }}
              placeholder="Search all chat sessions…"
              style={{
                width: '100%',
                background: surface.raised,
                border: 'none',
                borderBottom: `1px solid ${border[1]}`,
                padding: '8px 12px',
                fontSize: 12,
                color: fg[0],
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {historyQuery.trim() === '' ? (
                <div style={{ padding: '10px 12px', fontSize: 11, color: fg[4] }}>
                  Type to search across all {sessions.length} session{sessions.length !== 1 ? 's' : ''}.
                </div>
              ) : historyMatches.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 11, color: fg[4] }}>No matches.</div>
              ) : (
                historyMatches.map((m) => (
                  <button
                    key={m.messageId}
                    type="button"
                    onClick={() => jumpToMatch(m)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: 'none',
                      border: 'none',
                      borderBottom: `1px solid ${border[2]}`,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = surface.raised }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: accent.violet.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                        {m.sessionTitle}
                      </span>
                      <span style={{ fontSize: 9, color: fg[4] }}>{m.role === 'user' ? 'You' : 'Assistant'}</span>
                      <span style={{ fontSize: 9, color: fg[4], marginLeft: 'auto' }}>{new Date(m.timestamp).toLocaleDateString()}</span>
                    </div>
                    <div style={{ fontSize: 11, color: fg[2], lineHeight: 1.4 }}>{m.snippet}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
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
