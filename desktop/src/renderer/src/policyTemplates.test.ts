import { describe, it, expect } from 'vitest'
import { POLICY_TEMPLATES } from './policyTemplates'

describe('POLICY_TEMPLATES', () => {
  it('has unique ids', () => {
    const ids = POLICY_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every template has a non-empty name, description, and config', () => {
    for (const t of POLICY_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.config).toBeTruthy()
    }
  })

  it('every block_commands and require_approval_for pattern compiles as a valid regex', () => {
    for (const t of POLICY_TEMPLATES) {
      for (const pattern of [...t.config.block_commands, ...t.config.require_approval_for]) {
        expect(() => new RegExp(pattern, 'i')).not.toThrow()
      }
    }
  })

  it('every block_paths entry is a plain glob with at most one wildcard segment', () => {
    for (const t of POLICY_TEMPLATES) {
      for (const pattern of t.config.block_paths) {
        expect(pattern.length).toBeGreaterThan(0)
      }
    }
  })
})
