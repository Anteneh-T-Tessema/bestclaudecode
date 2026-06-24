import { describe, it, expect, vi, beforeEach } from 'vitest'

const storeData: Record<string, unknown> = {}

vi.mock('./store', () => ({
  store: {
    get: (key: string) => storeData[key],
    set: (key: string, value: unknown) => {
      storeData[key] = value
    },
  },
}))

import { resolveModel } from './modelRouter'

describe('resolveModel', () => {
  beforeEach(() => {
    for (const key of Object.keys(storeData)) delete storeData[key]
  })

  it('passes through any non-auto model id unchanged, regardless of task text or keys', () => {
    expect(resolveModel('gpt-4o', 'refactor the entire architecture')).toBe('gpt-4o')
    expect(resolveModel('claude-opus-4-8', 'x')).toBe('claude-opus-4-8')
    expect(resolveModel('gemini-1.5-pro', '')).toBe('gemini-1.5-pro')
  })

  it('falls back to claude-sonnet-4-6 for auto when no API keys are configured', () => {
    expect(resolveModel('auto', 'fix a typo')).toBe('claude-sonnet-4-6')
  })

  it('routes a short, simple task to the fast tier of the highest-priority configured provider', () => {
    storeData.anthropicApiKey = 'sk-ant-test'
    expect(resolveModel('auto', 'fix a typo in the README')).toBe('claude-haiku-4-5-20251001')
  })

  it('routes a long task to the strong tier', () => {
    storeData.anthropicApiKey = 'sk-ant-test'
    const longTask = 'a'.repeat(900)
    expect(resolveModel('auto', longTask)).toBe('claude-opus-4-8')
  })

  it('routes a task containing a complexity keyword to the strong tier even if short', () => {
    storeData.anthropicApiKey = 'sk-ant-test'
    expect(resolveModel('auto', 'please refactor this module')).toBe('claude-opus-4-8')
  })

  it('respects provider priority: anthropic before openai before google', () => {
    storeData.openaiApiKey = 'sk-test'
    storeData.googleApiKey = 'g-test'
    expect(resolveModel('auto', 'fix a typo')).toBe('gpt-4o-mini')
  })

  it('falls back to google when only a google key is configured', () => {
    storeData.googleApiKey = 'g-test'
    expect(resolveModel('auto', 'fix a typo')).toBe('gemini-2.0-flash')
  })

  it('strips auto-injected context-block tags before measuring complexity', () => {
    storeData.anthropicApiKey = 'sk-ant-test'
    const taskWithLongInjectedContext = `<auto_context query="foo">${'x'.repeat(2000)}</auto_context>\nfix a typo`
    expect(resolveModel('auto', taskWithLongInjectedContext)).toBe('claude-haiku-4-5-20251001')
  })

  it('never throws even with empty or unusual task text', () => {
    expect(() => resolveModel('auto', '')).not.toThrow()
    expect(() => resolveModel('not-auto-either', '')).not.toThrow()
  })
})
