/**
 * Gap 4 — Composer Panel: useComposerStore
 * Pure Zustand store — no Electron or DOM dependency, straightforward unit tests.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useComposerStore } from '../../renderer/src/store/useComposerStore'

function reset() {
  useComposerStore.setState({ isOpen: false, contextItems: [] })
}

describe('Gap 4 — useComposerStore', () => {
  beforeEach(reset)

  // ── open / close ────────────────────────────────────────────────────────────
  it('starts closed with no context items', () => {
    const { isOpen, contextItems } = useComposerStore.getState()
    expect(isOpen).toBe(false)
    expect(contextItems).toHaveLength(0)
  })

  it('open() sets isOpen to true', () => {
    useComposerStore.getState().open()
    expect(useComposerStore.getState().isOpen).toBe(true)
  })

  it('close() sets isOpen to false', () => {
    useComposerStore.getState().open()
    useComposerStore.getState().close()
    expect(useComposerStore.getState().isOpen).toBe(false)
  })

  it('open() then close() is idempotent on isOpen', () => {
    useComposerStore.getState().open()
    useComposerStore.getState().open()
    useComposerStore.getState().close()
    expect(useComposerStore.getState().isOpen).toBe(false)
  })

  // ── addContext ──────────────────────────────────────────────────────────────
  it('addContext appends a file item', () => {
    useComposerStore.getState().addContext({ type: 'file', value: 'src/app.ts' })
    const { contextItems } = useComposerStore.getState()
    expect(contextItems).toHaveLength(1)
    expect(contextItems[0]).toEqual({ type: 'file', value: 'src/app.ts' })
  })

  it('addContext appends symbol and selection items', () => {
    useComposerStore.getState().addContext({ type: 'symbol', value: 'fetchUser' })
    useComposerStore.getState().addContext({ type: 'selection', value: 'const x = 1' })
    useComposerStore.getState().addContext({ type: 'diff', value: '' })
    expect(useComposerStore.getState().contextItems).toHaveLength(3)
  })

  it('addContext preserves insertion order', () => {
    useComposerStore.getState().addContext({ type: 'file', value: 'a.ts' })
    useComposerStore.getState().addContext({ type: 'file', value: 'b.ts' })
    useComposerStore.getState().addContext({ type: 'symbol', value: 'myFn' })
    const items = useComposerStore.getState().contextItems
    expect(items.map((i) => i.value)).toEqual(['a.ts', 'b.ts', 'myFn'])
  })

  // ── removeContext ───────────────────────────────────────────────────────────
  it('removeContext(0) removes the first item', () => {
    useComposerStore.getState().addContext({ type: 'file', value: 'a.ts' })
    useComposerStore.getState().addContext({ type: 'file', value: 'b.ts' })
    useComposerStore.getState().removeContext(0)
    expect(useComposerStore.getState().contextItems).toHaveLength(1)
    expect(useComposerStore.getState().contextItems[0].value).toBe('b.ts')
  })

  it('removeContext on the last item leaves an empty list', () => {
    useComposerStore.getState().addContext({ type: 'symbol', value: 'fn' })
    useComposerStore.getState().removeContext(0)
    expect(useComposerStore.getState().contextItems).toHaveLength(0)
  })

  it('removeContext with out-of-range index is a no-op', () => {
    useComposerStore.getState().addContext({ type: 'file', value: 'x.ts' })
    useComposerStore.getState().removeContext(99)
    expect(useComposerStore.getState().contextItems).toHaveLength(1)
  })

  // ── clearContext ────────────────────────────────────────────────────────────
  it('clearContext empties the list', () => {
    useComposerStore.getState().addContext({ type: 'file', value: 'a.ts' })
    useComposerStore.getState().addContext({ type: 'diff', value: '' })
    useComposerStore.getState().clearContext()
    expect(useComposerStore.getState().contextItems).toHaveLength(0)
  })

  it('clearContext is a no-op on an already-empty list', () => {
    expect(() => useComposerStore.getState().clearContext()).not.toThrow()
    expect(useComposerStore.getState().contextItems).toHaveLength(0)
  })

  // ── independent state copies ────────────────────────────────────────────────
  it('getState() reflects mutations made via set actions', () => {
    useComposerStore.getState().open()
    useComposerStore.getState().addContext({ type: 'selection', value: 'hello' })
    const s = useComposerStore.getState()
    expect(s.isOpen).toBe(true)
    expect(s.contextItems[0].type).toBe('selection')
  })
})
