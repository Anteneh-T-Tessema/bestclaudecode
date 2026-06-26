/**
 * scanSandboxFiles() had zero test coverage before; adding minimal real
 * coverage here since this session's refactor moved its SECRET_PATTERNS
 * list out to ../secretPatterns.ts (shared with autonomousAgent.ts's
 * detectSecret() and the broadcast()-time redaction) — this confirms the
 * import change didn't silently break detection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { scanSandboxFiles } from './sandboxScanner'

describe('scanSandboxFiles', () => {
  let repoPath = ''

  beforeEach(() => {
    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-sandbox-scan-'))
    execSync('git init -q', { cwd: repoPath })
    execSync('git config user.email test@example.com', { cwd: repoPath })
    execSync('git config user.name Test', { cwd: repoPath })
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# hello\n')
    execSync('git add -A && git commit -q -m initial', { cwd: repoPath })
  })

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true })
  })

  it('flags an AWS access key in an uncommitted new file', () => {
    fs.writeFileSync(path.join(repoPath, 'config.js'), 'const KEY = "AKIAABCDEFGHIJKLMNOP"\n')
    const findings = scanSandboxFiles(repoPath, 'HEAD')
    expect(findings.some((f) => f.type === 'security' && f.message.includes('AWS access key'))).toBe(true)
  })

  it('flags a TODO as a quality finding', () => {
    fs.writeFileSync(path.join(repoPath, 'app.js'), '// TODO: fix this later\n')
    const findings = scanSandboxFiles(repoPath, 'HEAD')
    expect(findings.some((f) => f.type === 'quality' && f.message.includes('TODO'))).toBe(true)
  })

  it('returns no findings for a clean uncommitted file', () => {
    fs.writeFileSync(path.join(repoPath, 'clean.js'), 'export function add(a, b) { return a + b }\n')
    const findings = scanSandboxFiles(repoPath, 'HEAD')
    expect(findings).toEqual([])
  })

  it('returns no findings when there are no changes at all', () => {
    expect(scanSandboxFiles(repoPath, 'HEAD')).toEqual([])
  })
})
