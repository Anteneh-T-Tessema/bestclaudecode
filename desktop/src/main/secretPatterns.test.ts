import { describe, it, expect } from 'vitest'
import { detectSecret, redactSecrets, SECRET_PATTERNS } from './secretPatterns'

describe('detectSecret', () => {
  it.each([
    ['AWS access key', 'AKIAABCDEFGHIJKLMNOP'],
    ['GitHub PAT', 'ghp_' + 'a'.repeat(36)],
    ['PEM private key', '-----BEGIN RSA PRIVATE KEY-----'],
    ['PEM private key', '-----BEGIN PRIVATE KEY-----'],
    ['generic API secret', 'api_key: "abcdefghijklmnopqrstuvwx12"'],
    ['generic API secret', 'password="thisIsALongEnoughSecretValue1"'],
  ])('detects %s in %j', (name, content) => {
    expect(detectSecret(content)).toBe(name)
  })

  it('returns null for content with no secret-shaped substrings', () => {
    expect(detectSecret('just a normal log line, nothing to see here')).toBeNull()
  })

  it('returns null for a short value that does not meet the generic secret length threshold', () => {
    expect(detectSecret('password="short"')).toBeNull()
  })
})

describe('redactSecrets', () => {
  it('replaces a single secret with a [REDACTED:<name>] placeholder', () => {
    const out = redactSecrets('found this key: AKIAABCDEFGHIJKLMNOP in the file')
    expect(out).toBe('found this key: [REDACTED:AWS access key] in the file')
    expect(out).not.toContain('AKIA')
  })

  it('replaces every occurrence of a repeated secret, not just the first', () => {
    const secret = 'ghp_' + 'b'.repeat(36)
    const out = redactSecrets(`first: ${secret}\nsecond: ${secret}`)
    expect(out).not.toContain(secret)
    expect(out.match(/\[REDACTED:GitHub PAT\]/g)).toHaveLength(2)
  })

  it('redacts multiple distinct secret types in the same text', () => {
    const out = redactSecrets(`aws=AKIAABCDEFGHIJKLMNOP github=ghp_${'c'.repeat(36)}`)
    expect(out).toContain('[REDACTED:AWS access key]')
    expect(out).toContain('[REDACTED:GitHub PAT]')
  })

  it('returns plain text unchanged when nothing matches', () => {
    const text = 'totally ordinary command output, nothing sensitive'
    expect(redactSecrets(text)).toBe(text)
  })

  it('never throws on pathological input', () => {
    expect(() => redactSecrets('')).not.toThrow()
    expect(() => redactSecrets('x'.repeat(100_000))).not.toThrow()
  })
})

describe('SECRET_PATTERNS', () => {
  it('is the single shared list — not empty, every entry has a name and a RegExp', () => {
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0)
    for (const { name, re } of SECRET_PATTERNS) {
      expect(typeof name).toBe('string')
      expect(re).toBeInstanceOf(RegExp)
    }
  })
})
