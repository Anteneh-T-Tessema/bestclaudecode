import { describe, it, expect, beforeEach } from 'vitest'
import { setHandoff, getHandoff, listHandoffs, clearHandoff, clearAllHandoffs } from './agentHandoffStore'

describe('agentHandoffStore', () => {
  beforeEach(() => {
    clearAllHandoffs()
  })

  it('stores and retrieves a value by key', () => {
    setHandoff('schema', '{"users": []}')
    expect(getHandoff('schema')).toBe('{"users": []}')
  })

  it('returns null for unknown key', () => {
    expect(getHandoff('missing')).toBeNull()
  })

  it('lists all handoffs with previews', () => {
    setHandoff('a', 'alpha value')
    setHandoff('b', 'beta value')
    const list = listHandoffs()
    expect(list).toHaveLength(2)
    expect(list.find((h) => h.key === 'a')?.preview).toBe('alpha value')
    expect(list.find((h) => h.key === 'b')?.preview).toBe('beta value')
  })

  it('clears a specific key', () => {
    setHandoff('x', 'some data')
    const deleted = clearHandoff('x')
    expect(deleted).toBe(true)
    expect(getHandoff('x')).toBeNull()
  })
})
