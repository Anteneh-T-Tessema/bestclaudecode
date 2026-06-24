import { describe, it, expect, vi } from 'vitest'
import * as os from 'os'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
  },
}))

import { getAggregatedTools, callQualifiedTool } from './mcpManager'

describe('builtin search_codebase tool', () => {
  it('is included in getAggregatedTools with a valid JSON Schema', () => {
    const tools = getAggregatedTools()
    const builtin = tools.find((t) => t.qualifiedName === '_lakoora__search_codebase')
    expect(builtin).toBeDefined()
    expect(builtin?.inputSchema).toMatchObject({
      type: 'object',
      required: ['query'],
    })
  })

  it('returns a non-empty result string for a real query against this repo', async () => {
    const result = await callQualifiedTool('_lakoora__search_codebase', { query: 'hybrid search' })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result.startsWith('(no results')).toBe(false)
  }, 20000)

  it('returns a graceful fallback message, not a throw, on a nonsense query', async () => {
    const result = await callQualifiedTool('_lakoora__search_codebase', { query: '' })
    expect(typeof result).toBe('string')
    expect(result).toContain('no results')
  })
})
