import { describe, it, expect, vi } from 'vitest'
import { subscribe, publish } from './sessionRelay'

describe('sessionRelay', () => {
  it('delivers a published event to a subscriber on the same sessionId', () => {
    const received: unknown[] = []
    const unsubscribe = subscribe('session-1', (event) => received.push(event))
    publish('session-1', { status: 'running' })
    expect(received).toEqual([{ status: 'running' }])
    unsubscribe()
  })

  it('delivers to multiple subscribers on the same sessionId', () => {
    const a: unknown[] = []
    const b: unknown[] = []
    const unsubA = subscribe('session-1', (e) => a.push(e))
    const unsubB = subscribe('session-1', (e) => b.push(e))
    publish('session-1', { status: 'done' })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    unsubA()
    unsubB()
  })

  it('does not deliver to a subscriber on a different sessionId', () => {
    const received: unknown[] = []
    const unsubscribe = subscribe('session-1', (e) => received.push(e))
    publish('session-2', { status: 'running' })
    expect(received).toHaveLength(0)
    unsubscribe()
  })

  it('stops delivering after unsubscribe', () => {
    const received: unknown[] = []
    const unsubscribe = subscribe('session-1', (e) => received.push(e))
    unsubscribe()
    publish('session-1', { status: 'running' })
    expect(received).toHaveLength(0)
  })

  it('publishing to an unknown sessionId is a no-op, not a throw', () => {
    expect(() => publish('no-such-session', { status: 'running' })).not.toThrow()
  })

  it('one throwing listener does not block delivery to others', () => {
    const received: unknown[] = []
    const unsubA = subscribe('session-1', () => { throw new Error('boom') })
    const unsubB = subscribe('session-1', (e) => received.push(e))
    expect(() => publish('session-1', { status: 'running' })).not.toThrow()
    expect(received).toHaveLength(1)
    unsubA()
    unsubB()
  })

  it('calling the same unsubscribe twice is harmless', () => {
    const cb = vi.fn()
    const unsubscribe = subscribe('session-1', cb)
    unsubscribe()
    expect(() => unsubscribe()).not.toThrow()
  })
})
