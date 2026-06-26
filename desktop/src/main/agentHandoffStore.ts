/**
 * In-memory cross-agent handoff store (main process only).
 * Agents write named values via <<<HANDOFF>>> blocks; other agents or the
 * renderer can read them via @handoff:<key> mentions.
 *
 * Swarm coordination — each entry also records which role wrote it (if any)
 * and when, so e.g. a security-review agent can tell *what the backend agent
 * just wrote* instead of reading an unattributed global value. getHandoff()
 * keeps returning a bare string for existing callers (the <<<EDIT>>>-style
 * inline mentions don't need attribution); listHandoffs() exposes the
 * attribution for swarm-aware UI/tooling.
 */

interface HandoffEntry {
  value: string
  writtenByRole: string | null
  ts: number
}

const store = new Map<string, HandoffEntry>()

export function setHandoff(key: string, value: string, writtenByRole: string | null = null): void {
  store.set(key, { value, writtenByRole, ts: Date.now() })
}

export function getHandoff(key: string): string | null {
  return store.get(key)?.value ?? null
}

export function listHandoffs(): Array<{ key: string; preview: string; writtenByRole: string | null; ts: number }> {
  return [...store.entries()].map(([key, entry]) => ({
    key,
    preview: entry.value.slice(0, 120),
    writtenByRole: entry.writtenByRole,
    ts: entry.ts,
  }))
}

export function clearHandoff(key: string): boolean {
  return store.delete(key)
}

export function clearAllHandoffs(): void {
  store.clear()
}
