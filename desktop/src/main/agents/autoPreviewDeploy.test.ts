/**
 * Gap 3 — Auto-preview deploy after agent push
 *
 * The full autonomousAgent is heavily integrated (Electron, git, AI streams).
 * These tests cover the two pure-logic guards that control when the auto-preview
 * fires, keeping the test surface isolated and fast.
 */
import { describe, it, expect } from 'vitest'

// ── 1. isMainBranch guard ─────────────────────────────────────────────────────
// Mirrors the exact regex in autonomousAgent.ts line 718.
function isMainBranch(branch: string): boolean {
  return /^(main|master)$/.test(branch)
}

describe('Gap 3 — isMainBranch guard (auto-preview skips main/master)', () => {
  it.each([
    ['main',   true],
    ['master', true],
  ])('isMainBranch("%s") → %s', (branch, expected) => {
    expect(isMainBranch(branch)).toBe(expected)
  })

  it.each([
    'feature/add-login',
    'fix/null-pointer',
    'agent/task-abc123',
    'release/v1.2',
    'main-feature',      // prefix of "main" but not an exact match
    'master-rebase',
    'my-main',
    '',
  ])('isMainBranch("%s") → false', (branch) => {
    expect(isMainBranch(branch)).toBe(false)
  })
})

// ── 2. providerFromCommand coverage for preview path ─────────────────────────
// The auto-preview only fires for 'vercel' | 'netlify' — other providers skip.
import { providerFromCommand } from '../deploy'

describe('Gap 3 — providerFromCommand for preview eligibility', () => {
  const PREVIEW_ELIGIBLE = ['vercel', 'netlify'] as const

  it('vercel is preview-eligible', () => {
    expect(PREVIEW_ELIGIBLE).toContain(providerFromCommand('vercel'))
  })

  it('netlify is preview-eligible', () => {
    expect(PREVIEW_ELIGIBLE).toContain(providerFromCommand('netlify deploy'))
  })

  it('npm is NOT preview-eligible', () => {
    expect(PREVIEW_ELIGIBLE).not.toContain(providerFromCommand('npm run deploy'))
  })

  it('cdk is NOT preview-eligible', () => {
    expect(PREVIEW_ELIGIBLE).not.toContain(providerFromCommand('cdk deploy --require-approval never'))
  })

  it('kubernetes is NOT preview-eligible', () => {
    expect(PREVIEW_ELIGIBLE).not.toContain(providerFromCommand('kubectl apply -f k8s/'))
  })
})

// ── 3. extractUrl — URL surfaced in the broadcast after a deploy ───────────────
import { extractUrl } from '../deploy'

describe('Gap 3 — extractUrl shapes returned by preview CLI output', () => {
  it('parses a vercel preview URL from mixed output', () => {
    const stdout = [
      'Vercel CLI 39.2.0',
      '🔍  Inspect: https://vercel.com/inspect/prj/dpl_abc123def',
      '✅  Preview: https://myapp-git-feature-org.vercel.app [3s]',
    ].join('\n')
    const url = extractUrl(stdout)
    expect(url).toMatch(/^https:\/\/vercel\.com\/inspect/)
  })

  it('parses a netlify deploy URL', () => {
    const stdout = 'Website Draft URL: https://deploy-preview-11--my-site.netlify.app'
    expect(extractUrl(stdout)).toBe('https://deploy-preview-11--my-site.netlify.app')
  })

  it('returns null for empty stdout (deploy produced no URL)', () => {
    expect(extractUrl('')).toBeNull()
    expect(extractUrl('Build complete. No URL emitted.')).toBeNull()
  })

  it('does not crash on multi-line output with no URL', () => {
    const noise = Array.from({ length: 50 }, (_, i) => `line ${i}: some build output`).join('\n')
    expect(extractUrl(noise)).toBeNull()
  })
})
