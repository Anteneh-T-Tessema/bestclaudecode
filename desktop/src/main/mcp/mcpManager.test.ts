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

describe('builtin find_callers tool', () => {
  it('is included in getAggregatedTools with a valid JSON Schema', () => {
    const tools = getAggregatedTools()
    const builtin = tools.find((t) => t.qualifiedName === '_lakoora__find_callers')
    expect(builtin).toBeDefined()
    expect(builtin?.inputSchema).toMatchObject({
      type: 'object',
      required: ['function_name'],
    })
  })

  it('finds a real call site for a function called elsewhere in this repo', async () => {
    const result = await callQualifiedTool('_lakoora__find_callers', { function_name: 'hybrid_search' })
    expect(typeof result).toBe('string')
    expect(result).toContain('chat_context.py')
  }, 20000)

  it('returns a graceful fallback message, not a throw, when no call sites exist', async () => {
    const result = await callQualifiedTool('_lakoora__find_callers', { function_name: 'zzznonexistentfn' })
    expect(typeof result).toBe('string')
    expect(result).toContain('no call sites found')
  }, 20000)
})

describe('builtin get_dependencies tool', () => {
  it('is included in getAggregatedTools with a valid JSON Schema', () => {
    const tools = getAggregatedTools()
    const builtin = tools.find((t) => t.qualifiedName === '_lakoora__get_dependencies')
    expect(builtin).toBeDefined()
    expect(builtin?.inputSchema).toMatchObject({
      type: 'object',
      required: ['file'],
    })
  })

  it("defaults to depends_on and lists this file's real imports", async () => {
    const result = await callQualifiedTool('_lakoora__get_dependencies', { file: 'src/chat_context.py' })
    expect(typeof result).toBe('string')
    expect(result).toContain('vector_index.py')
  }, 20000)

  it('dependents_of finds real importers of a known module', async () => {
    const result = await callQualifiedTool('_lakoora__get_dependencies', {
      file: 'src/vector_index.py',
      direction: 'dependents_of',
    })
    expect(typeof result).toBe('string')
    expect(result).toContain('chat_context.py')
  }, 20000)
})
