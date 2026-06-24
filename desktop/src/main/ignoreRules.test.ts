import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadIgnoreRules, isIgnored } from './ignoreRules'

function withGitignore(content: string, fn: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lakoora-ignore-test-'))
  fs.writeFileSync(path.join(root, '.gitignore'), content, 'utf-8')
  try {
    fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('loadIgnoreRules + isIgnored', () => {
  it('matches a bare directory name at any depth', () => {
    withGitignore('dist/\n', (root) => {
      const rules = loadIgnoreRules(root)
      expect(isIgnored('dist', rules)).toBe(true)
      expect(isIgnored('desktop/dist', rules)).toBe(true)
      expect(isIgnored('distillery', rules)).toBe(false)
    })
  })

  it('matches a glob with a wildcard suffix', () => {
    withGitignore('desktop/.e2e-cdp-port*\n', (root) => {
      const rules = loadIgnoreRules(root)
      expect(isIgnored('desktop/.e2e-cdp-port', rules)).toBe(true)
      expect(isIgnored('desktop/.e2e-cdp-port.userdata', rules)).toBe(true)
      expect(isIgnored('desktop/other-file', rules)).toBe(false)
    })
  })

  it('anchors a leading-slash pattern to the project root', () => {
    withGitignore('/build\n', (root) => {
      const rules = loadIgnoreRules(root)
      expect(isIgnored('build', rules)).toBe(true)
      expect(isIgnored('nested/build', rules)).toBe(false)
    })
  })

  it('ignores comments and blank lines', () => {
    withGitignore('# a comment\n\n  \nnode_modules/\n', (root) => {
      const rules = loadIgnoreRules(root)
      expect(rules.length).toBe(1)
      expect(isIgnored('node_modules', rules)).toBe(true)
    })
  })

  it('skips negated patterns rather than mis-handling them', () => {
    withGitignore('*.log\n!keep.log\n', (root) => {
      const rules = loadIgnoreRules(root)
      expect(isIgnored('debug.log', rules)).toBe(true)
      // Negation unsupported: keep.log still matches *.log (documented limitation).
      expect(isIgnored('keep.log', rules)).toBe(true)
    })
  })

  it('returns no rules when no ignore file exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lakoora-ignore-test-empty-'))
    try {
      expect(loadIgnoreRules(root)).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
