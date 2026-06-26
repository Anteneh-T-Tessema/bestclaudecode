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

  it('attributes a handoff to the role that wrote it', () => {
    setHandoff('schema', '{"users": []}', 'backend')
    const entry = listHandoffs().find((h) => h.key === 'schema')
    expect(entry?.writtenByRole).toBe('backend')
  })

  it('defaults writtenByRole to null when not specified', () => {
    setHandoff('untagged', 'value')
    const entry = listHandoffs().find((h) => h.key === 'untagged')
    expect(entry?.writtenByRole).toBeNull()
  })

  it('records a timestamp for each entry', () => {
    const before = Date.now()
    setHandoff('timed', 'value')
    const entry = listHandoffs().find((h) => h.key === 'timed')
    expect(entry?.ts).toBeGreaterThanOrEqual(before)
  })

  it('overwriting a key updates its role attribution', () => {
    setHandoff('shared', 'first', 'backend')
    setHandoff('shared', 'second', 'frontend')
    const entry = listHandoffs().find((h) => h.key === 'shared')
    expect(entry?.preview).toBe('second')
    expect(entry?.writtenByRole).toBe('frontend')
  })
})
