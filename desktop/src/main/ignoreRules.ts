/**
 * Minimal gitignore-style pattern matching for the file explorer and the
 * @file/@folder pickers. Reads .gitignore and .meshflowignore (both, unioned)
 * from the project root.
 *
 * Deliberately simplified vs real gitignore semantics: no "!" negation, no
 * "**" globstar, no per-directory nested ignore files — one pattern set read
 * from the project root, applied repo-wide. Covers the common case (ignoring
 * build output dirs, lockfiles, logs) without pulling in a glob dependency.
 */
import * as fsSync from 'fs'
import * as path from 'path'

interface IgnoreRule {
  regex: RegExp
}

function compilePattern(raw: string): IgnoreRule | null {
  let p = raw.trim()
  if (!p || p.startsWith('#') || p.startsWith('!')) return null
  const anchored = p.startsWith('/')
  if (anchored) p = p.slice(1)
  if (p.endsWith('/')) p = p.slice(0, -1)
  if (!p) return null
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  const pattern = anchored ? `^${escaped}(/.*)?$` : `(^|/)${escaped}(/.*)?$`
  return { regex: new RegExp(pattern) }
}

export function loadIgnoreRules(root: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const file of ['.gitignore', '.meshflowignore']) {
    try {
      const raw = fsSync.readFileSync(path.join(root, file), 'utf-8')
      for (const line of raw.split('\n')) {
        const rule = compilePattern(line)
        if (rule) rules.push(rule)
      }
    } catch { /* file doesn't exist — fine */ }
  }
  return rules
}

export function isIgnored(relPath: string, rules: IgnoreRule[]): boolean {
  if (rules.length === 0) return false
  const normalized = relPath.split(path.sep).join('/')
  return rules.some((r) => r.regex.test(normalized))
}
