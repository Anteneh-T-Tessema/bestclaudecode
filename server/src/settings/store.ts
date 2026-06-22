// Session-scoped in-memory settings — NOT persistent and NOT encrypted.
// Desktop's electron-store + keytar-backed persistence has no direct cloud
// equivalent yet; real per-user encrypted secret storage behind auth/DB is
// follow-up work once Phase 0 has real accounts, not invented here.
export const MUTABLE_KEYS = new Set([
  'theme', 'fontSize', 'sidebarWidth', 'rightPanelWidth',
  'bottomPanelHeight', 'projectPath', 'recentProjects', 'ollamaUrl', 'activeModel',
  'completionModel',
])

// Kept separate from MUTABLE_KEYS so settings:getAll never echoes secrets
// back to the client, even though both live in the same in-memory map.
export const SECRET_KEYS = new Set([
  'anthropicApiKey', 'openaiApiKey', 'googleApiKey',
  // Phase 2: FIM completion providers
  'mistralApiKey', 'fireworksApiKey',
])

const storesBySession = new Map<string, Map<string, unknown>>()

function sessionStore(sessionId: string): Map<string, unknown> {
  let store = storesBySession.get(sessionId)
  if (!store) {
    store = new Map()
    storesBySession.set(sessionId, store)
  }
  return store
}

export function getSetting(sessionId: string, key: string): unknown {
  return sessionStore(sessionId).get(key)
}

export function setSetting(sessionId: string, key: string, value: unknown): void {
  sessionStore(sessionId).set(key, value)
}

export function getAllPublicSettings(sessionId: string): Record<string, unknown> {
  const store = sessionStore(sessionId)
  const result: Record<string, unknown> = {}
  for (const key of MUTABLE_KEYS) {
    if (store.has(key)) result[key] = store.get(key)
  }
  return result
}

export function clearSessionSettings(sessionId: string): void {
  storesBySession.delete(sessionId)
}
