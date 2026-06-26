import { create } from 'zustand'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  images?: string[]
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  /** Gap 56 — accumulated token usage for this session, persisted across restarts for the usage dashboard. */
  usage?: { inputTokens: number; outputTokens: number; costUsd: number; lastModel: string }
}

export const MODELS = [
  { id: 'auto', label: 'Auto', provider: 'auto' },
  // Anthropic
  { id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  // OpenAI
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'o1', label: 'o1', provider: 'openai' },
  // Google
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', provider: 'google' },
  // Groq (fast open-model inference)
  { id: 'groq/llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', provider: 'groq' },
  { id: 'groq/llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Groq)', provider: 'groq' },
  { id: 'groq/mixtral-8x7b-32768', label: 'Mixtral 8x7B (Groq)', provider: 'groq' },
  { id: 'groq/gemma2-9b-it', label: 'Gemma 2 9B (Groq)', provider: 'groq' },
  { id: 'groq/deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 70B (Groq)', provider: 'groq' },
  // OpenRouter (100+ models, one key)
  { id: 'openrouter/meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (OpenRouter)', provider: 'openrouter' },
  { id: 'openrouter/anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (OpenRouter)', provider: 'openrouter' },
  { id: 'openrouter/deepseek/deepseek-r1', label: 'DeepSeek R1 (OpenRouter)', provider: 'openrouter' },
  { id: 'openrouter/mistralai/mistral-large', label: 'Mistral Large (OpenRouter)', provider: 'openrouter' },
  // Ollama (local)
  { id: 'ollama', label: 'Ollama (local — pick model in Settings)', provider: 'ollama' },
  // Custom
  { id: 'custom', label: 'Custom Model', provider: 'custom' },
] as const

export type ModelId = (typeof MODELS)[number]['id']

const SESSIONS_KEY = 'meshflow:chat:sessions'
const LEGACY_KEY = 'meshflow:chat:messages'

function makeSession(messages: ChatMessage[] = []): ChatSession {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: 'New Chat',
    messages,
    createdAt: Date.now(),
  }
}

function loadInitialState(): { sessions: ChatSession[]; activeSessionId: string } {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { sessions: ChatSession[]; activeSessionId: string }
      if (Array.isArray(parsed?.sessions) && parsed.sessions.length > 0) {
        return { sessions: parsed.sessions, activeSessionId: parsed.activeSessionId ?? parsed.sessions[0].id }
      }
    }
  } catch { /* ignore */ }

  // Migrate legacy flat messages → single session
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const msgs = JSON.parse(legacy) as ChatMessage[]
      if (Array.isArray(msgs) && msgs.length > 0) {
        const session = makeSession(msgs.slice(-100))
        if (msgs[0]?.content) session.title = msgs[0].content.slice(0, 40)
        localStorage.removeItem(LEGACY_KEY)
        const result = { sessions: [session], activeSessionId: session.id }
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(result))
        return result
      }
    }
  } catch { /* ignore */ }

  const session = makeSession()
  return { sessions: [session], activeSessionId: session.id }
}

function persist(sessions: ChatSession[], activeSessionId: string) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify({ sessions, activeSessionId }))
  } catch { /* ignore */ }
}

interface ChatStore {
  sessions: ChatSession[]
  activeSessionId: string
  activeModel: ModelId
  isStreaming: boolean
  streamingId: string | null
  activeStreamId: string | null
  composerMode: boolean
  setComposerMode: (on: boolean) => void

  // Session management
  createSession: () => string
  deleteSession: (id: string) => void
  switchSession: (id: string) => void
  renameSession: (id: string, title: string) => void

  // Message actions (operate on active session)
  addUserMessage: (content: string, images?: string[]) => string
  startAssistantMessage: () => string
  appendDelta: (id: string, delta: string) => void
  finalizeMessage: (id: string) => void
  setStreaming: (streamId: string | null) => void
  clearMessages: () => void
  setActiveModel: (model: ModelId) => void

  // Gap 56 — per-session usage accumulation, persisted for the usage dashboard.
  addSessionUsage: (sessionId: string, inputTokens: number, outputTokens: number, costUsd: number, model: string) => void
}

const initial = loadInitialState()

export const useChatStore = create<ChatStore>((set) => ({
  sessions: initial.sessions,
  activeSessionId: initial.activeSessionId,
  activeModel: 'claude-sonnet-4-6',
  isStreaming: false,
  streamingId: null,
  activeStreamId: null,
  composerMode: false,
  setComposerMode: (on) => set({ composerMode: on }),

  createSession: () => {
    const session = makeSession()
    set((s) => {
      const sessions = [...s.sessions, session]
      persist(sessions, session.id)
      return { sessions, activeSessionId: session.id, isStreaming: false, streamingId: null, activeStreamId: null }
    })
    return session.id
  },

  deleteSession: (id) => {
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== id)
      if (sessions.length === 0) {
        const fresh = makeSession()
        sessions.push(fresh)
      }
      const activeSessionId = s.activeSessionId === id ? sessions[sessions.length - 1].id : s.activeSessionId
      persist(sessions, activeSessionId)
      return { sessions, activeSessionId }
    })
  },

  switchSession: (id) => {
    set((s) => {
      persist(s.sessions, id)
      return { activeSessionId: id, isStreaming: false, streamingId: null, activeStreamId: null }
    })
  },

  renameSession: (id, title) => {
    set((s) => {
      const sessions = s.sessions.map((sess) => sess.id === id ? { ...sess, title } : sess)
      persist(sessions, s.activeSessionId)
      return { sessions }
    })
  },

  addUserMessage: (content, images) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const msg: ChatMessage = { id, role: 'user', content, timestamp: Date.now(), ...(images?.length ? { images } : {}) }
    set((s) => {
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.activeSessionId) return sess
        const messages = [...sess.messages, msg].slice(-100)
        // Auto-title from first user message
        const title = sess.messages.length === 0 && sess.title === 'New Chat'
          ? content.slice(0, 40) || 'New Chat'
          : sess.title
        return { ...sess, messages, title }
      })
      persist(sessions, s.activeSessionId)
      return { sessions }
    })
    return id
  },

  startAssistantMessage: () => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const msg: ChatMessage = { id, role: 'assistant', content: '', timestamp: Date.now() }
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === s.activeSessionId
          ? { ...sess, messages: [...sess.messages, msg] }
          : sess
      )
      return { sessions, isStreaming: true, streamingId: id }
    })
    return id
  },

  appendDelta: (id, delta) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === s.activeSessionId
          ? { ...sess, messages: sess.messages.map((m) => m.id === id ? { ...m, content: m.content + delta } : m) }
          : sess
      ),
    }))
  },

  finalizeMessage: (id) => {
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === s.activeSessionId
          ? { ...sess, messages: sess.messages.map((m) => m.id === id ? { ...m } : m) }
          : sess
      )
      persist(sessions, s.activeSessionId)
      return { sessions, isStreaming: false, streamingId: null, activeStreamId: null }
    })
  },

  setStreaming: (streamId) => {
    set({ activeStreamId: streamId, isStreaming: streamId !== null })
  },

  clearMessages: () => {
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === s.activeSessionId ? { ...sess, messages: [], title: 'New Chat' } : sess
      )
      persist(sessions, s.activeSessionId)
      return { sessions, isStreaming: false, streamingId: null, activeStreamId: null }
    })
  },

  setActiveModel: (model) => set({ activeModel: model }),

  addSessionUsage: (sessionId, inputTokens, outputTokens, costUsd, model) => {
    set((s) => {
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess
        const prev = sess.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, lastModel: '' }
        return {
          ...sess,
          usage: {
            inputTokens: prev.inputTokens + inputTokens,
            outputTokens: prev.outputTokens + outputTokens,
            costUsd: prev.costUsd + costUsd,
            lastModel: model,
          },
        }
      })
      persist(sessions, s.activeSessionId)
      return { sessions }
    })
  },
}))
