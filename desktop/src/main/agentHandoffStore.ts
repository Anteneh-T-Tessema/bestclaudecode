/**
 * In-memory cross-agent handoff store (main process only).
 * Agents write named values via <<<HANDOFF>>> blocks; other agents or the
 * renderer can read them via @handoff:<key> mentions.
 */

const store = new Map<string, string>()

export function setHandoff(key: string, value: string): void {
  store.set(key, value)
}

export function getHandoff(key: string): string | null {
  return store.get(key) ?? null
}

export function listHandoffs(): Array<{ key: string; preview: string }> {
  return [...store.entries()].map(([key, value]) => ({
    key,
    preview: value.slice(0, 120),
  }))
}

export function clearHandoff(key: string): boolean {
  return store.delete(key)
}

export function clearAllHandoffs(): void {
  store.clear()
}
