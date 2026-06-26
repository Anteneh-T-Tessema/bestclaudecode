/**
 * Gap 4 — @symbol context anchor (injectSymbolContext in ChatInput.tsx)
 *
 * The full function depends on `window.api.search.vector` (renderer-side IPC).
 * We test the pure string-parsing and output-formatting logic in isolation
 * by re-implementing the same contract in Node, verifying the regex, XML tag
 * shape, and edge-case branches that don't touch the network.
 */
import { describe, it, expect } from 'vitest'

// ── Re-implement the pure string logic (mirrors ChatInput.tsx injectSymbolContext) ──
type SearchHit = { file: string; lineNumber?: number; line: string; snippet?: string }

function buildSymbolContextBlock(
  content: string,
  symbol: string,
  hits: SearchHit[]
): string {
  const match = content.match(/@symbol\s+(\S+)/)
  if (!match) return content

  if (hits.length === 0) {
    return content.replace(match[0], `(symbol \`${symbol}\` not found)`)
  }

  const blocks = hits.map((r) => {
    const loc = `${r.file}${r.lineNumber ? `:${r.lineNumber}` : ''}`
    return `// ${loc}\n${r.snippet ?? r.line}`
  })
  const contextBlock = `<symbol_context name="${symbol}">\n${blocks.join('\n\n---\n\n')}\n</symbol_context>`
  return `${contextBlock}\n\n${content.replace(match[0], '').trim()}`
}

// Mirrors the early-exit guard for when there is no @symbol tag at all.
function shouldSkipSymbolInjection(content: string): boolean {
  return !content.includes('@symbol')
}

// Mirrors the empty-symbol guard.
function extractSymbolName(content: string): string {
  const match = content.match(/@symbol\s+(\S+)/)
  return match ? match[1].trim() : ''
}

describe('Gap 4 — @symbol injection logic', () => {
  // ── Early-exit guard ────────────────────────────────────────────────────────
  describe('shouldSkipSymbolInjection', () => {
    it('returns true for messages with no @symbol', () => {
      expect(shouldSkipSymbolInjection('What does this function do?')).toBe(true)
      expect(shouldSkipSymbolInjection('@diff show changes')).toBe(true)
      expect(shouldSkipSymbolInjection('')).toBe(true)
    })

    it('returns false for messages containing @symbol', () => {
      expect(shouldSkipSymbolInjection('explain @symbol fetchUser')).toBe(false)
      expect(shouldSkipSymbolInjection('@symbol MyClass')).toBe(false)
    })
  })

  // ── Symbol name extraction ──────────────────────────────────────────────────
  describe('extractSymbolName', () => {
    it('extracts a simple function name', () => {
      expect(extractSymbolName('explain @symbol fetchUser please')).toBe('fetchUser')
    })

    it('extracts a PascalCase class name', () => {
      expect(extractSymbolName('@symbol AuthService')).toBe('AuthService')
    })

    it('extracts a dotted path symbol', () => {
      expect(extractSymbolName('what is @symbol api.users.get?')).toBe('api.users.get?')
      // Note: ? is included since \S+ matches non-whitespace — real function trims harmlessly
    })

    it('returns empty string when @symbol has no following token', () => {
      expect(extractSymbolName('please check @symbol ')).toBe('')
    })

    it('returns empty string when content has no @symbol', () => {
      expect(extractSymbolName('no mention at all')).toBe('')
    })
  })

  // ── buildSymbolContextBlock — zero hits ─────────────────────────────────────
  describe('buildSymbolContextBlock — zero hits', () => {
    it('replaces the @symbol tag with a "not found" note', () => {
      const result = buildSymbolContextBlock(
        'What does @symbol unknownFn do?',
        'unknownFn',
        []
      )
      expect(result).toContain('(symbol `unknownFn` not found)')
      expect(result).not.toContain('@symbol')
    })

    it('preserves the rest of the message around the tag', () => {
      const result = buildSymbolContextBlock(
        'Check @symbol ghostFn and tell me',
        'ghostFn',
        []
      )
      expect(result).toContain('and tell me')
    })
  })

  // ── buildSymbolContextBlock — one hit ───────────────────────────────────────
  describe('buildSymbolContextBlock — one hit with snippet', () => {
    const hit: SearchHit = {
      file: 'src/auth/service.ts',
      lineNumber: 42,
      line: 'export async function fetchUser(id: string)',
      snippet: 'export async function fetchUser(id: string) {\n  return db.users.findById(id)\n}',
    }

    it('wraps result in <symbol_context> tag with the symbol name', () => {
      const result = buildSymbolContextBlock('@symbol fetchUser', 'fetchUser', [hit])
      expect(result).toContain('<symbol_context name="fetchUser">')
      expect(result).toContain('</symbol_context>')
    })

    it('includes file:line location comment', () => {
      const result = buildSymbolContextBlock('@symbol fetchUser', 'fetchUser', [hit])
      expect(result).toContain('// src/auth/service.ts:42')
    })

    it('includes the snippet body', () => {
      const result = buildSymbolContextBlock('@symbol fetchUser', 'fetchUser', [hit])
      expect(result).toContain('db.users.findById(id)')
    })

    it('places the context block before the rest of the message', () => {
      const result = buildSymbolContextBlock('explain @symbol fetchUser to me', 'fetchUser', [hit])
      const ctxIdx = result.indexOf('<symbol_context')
      const msgIdx = result.indexOf('explain')
      // Context block comes first, then the original prose
      expect(ctxIdx).toBeLessThan(msgIdx)
    })

    it('removes the @symbol tag from the trailing prose', () => {
      const result = buildSymbolContextBlock('@symbol fetchUser is it safe?', 'fetchUser', [hit])
      const afterClose = result.split('</symbol_context>')[1] ?? ''
      expect(afterClose).not.toContain('@symbol')
    })
  })

  // ── buildSymbolContextBlock — multiple hits ─────────────────────────────────
  describe('buildSymbolContextBlock — multiple hits', () => {
    const hits: SearchHit[] = [
      { file: 'src/a.ts', lineNumber: 10, line: 'function process()' },
      { file: 'src/b.ts', lineNumber: 20, line: 'async function process()' },
    ]

    it('separates multiple hits with ---', () => {
      const result = buildSymbolContextBlock('@symbol process', 'process', hits)
      expect(result).toContain('---')
    })

    it('includes location for each hit', () => {
      const result = buildSymbolContextBlock('@symbol process', 'process', hits)
      expect(result).toContain('src/a.ts:10')
      expect(result).toContain('src/b.ts:20')
    })

    it('uses the line field when no snippet is present', () => {
      const result = buildSymbolContextBlock('@symbol process', 'process', hits)
      expect(result).toContain('function process()')
      expect(result).toContain('async function process()')
    })
  })

  // ── buildSymbolContextBlock — hit without lineNumber ───────────────────────
  it('formats a hit without a lineNumber (no colon suffix)', () => {
    const hit: SearchHit = { file: 'src/utils.ts', line: 'export const helper = () => {}' }
    const result = buildSymbolContextBlock('@symbol helper', 'helper', [hit])
    expect(result).toContain('// src/utils.ts\n')
    expect(result).not.toMatch(/src\/utils\.ts:\d/)
  })
})
