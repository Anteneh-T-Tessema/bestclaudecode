/**
 * In-memory pub/sub so remote viewers (over SSE, via webhookServer.ts) can
 * receive an agent session's live events alongside the existing local
 * BrowserWindow push. autonomousAgent.ts's broadcast() calls publish() here
 * as a third side effect, next to its existing appendEvent + window push —
 * this module has no knowledge of agent internals, just a sessionId key.
 */

type Listener = (event: Record<string, unknown>) => void

const subscribers = new Map<string, Set<Listener>>()

export function subscribe(sessionId: string, listener: Listener): () => void {
  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set())
  subscribers.get(sessionId)!.add(listener)
  return () => {
    const set = subscribers.get(sessionId)
    set?.delete(listener)
    if (set && set.size === 0) subscribers.delete(sessionId)
  }
}

export function publish(sessionId: string, event: Record<string, unknown>): void {
  for (const listener of subscribers.get(sessionId) ?? []) {
    try {
      listener(event)
    } catch {
      // One bad subscriber must not break others or the agent loop.
    }
  }
}
