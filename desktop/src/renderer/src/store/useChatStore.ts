import { create } from 'zustand'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google' },
] as const

export type ModelId = (typeof MODELS)[number]['id']

const PERSIST_KEY = 'lakoora:chat:messages'

function loadPersistedMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : []
  } catch {
    return []
  }
}

function persistMessages(messages: ChatMessage[]): void {
  try {
    // Keep only last 100 messages to avoid localStorage bloat
    const toSave = messages.slice(-100)
    localStorage.setItem(PERSIST_KEY, JSON.stringify(toSave))
  } catch {
    // Ignore storage errors
  }
}

interface ChatStore {
  messages: ChatMessage[]
  activeModel: ModelId
  isStreaming: boolean
  streamingId: string | null
  activeStreamId: string | null
  addUserMessage: (content: string) => string
  startAssistantMessage: () => string
  appendDelta: (id: string, delta: string) => void
  finalizeMessage: (id: string) => void
  setStreaming: (streamId: string | null) => void
  clearMessages: () => void
  setActiveModel: (model: ModelId) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: loadPersistedMessages(),
  activeModel: 'claude-sonnet-4-6',
  isStreaming: false,
  streamingId: null,
  activeStreamId: null,

  addUserMessage: (content) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const msg: ChatMessage = { id, role: 'user', content, timestamp: Date.now() }
    set((s) => {
      const messages = [...s.messages, msg]
      persistMessages(messages)
      return { messages }
    })
    return id
  },

  startAssistantMessage: () => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const msg: ChatMessage = { id, role: 'assistant', content: '', timestamp: Date.now() }
    set((s) => {
      const messages = [...s.messages, msg]
      return { messages, isStreaming: true, streamingId: id }
    })
    return id
  },

  appendDelta: (id, delta) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m
      ),
    }))
  },

  finalizeMessage: (id) => {
    set((s) => {
      const messages = s.messages.map((m) =>
        m.id === id ? { ...m } : m
      )
      persistMessages(messages)
      return { messages, isStreaming: false, streamingId: null, activeStreamId: null }
    })
  },

  setStreaming: (streamId) => {
    set({ activeStreamId: streamId, isStreaming: streamId !== null })
  },

  clearMessages: () => {
    persistMessages([])
    set({ messages: [], isStreaming: false, streamingId: null, activeStreamId: null })
  },

  setActiveModel: (model) => set({ activeModel: model }),
}))
