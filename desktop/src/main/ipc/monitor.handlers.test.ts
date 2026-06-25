import { describe, it, expect } from 'vitest'
import { splitLines, ERROR_PATTERN } from './monitor.handlers'

describe('splitLines', () => {
  it('returns no lines and buffers everything when a chunk has no newline', () => {
    const { lines, remainder } = splitLines('', 'partial line with no newline yet')
    expect(lines).toEqual([])
    expect(remainder).toBe('partial line with no newline yet')
  })

  it('splits a single chunk with multiple complete lines', () => {
    const { lines, remainder } = splitLines('', 'line one\nline two\nline three\n')
    expect(lines).toEqual(['line one', 'line two', 'line three'])
    expect(remainder).toBe('')
  })

  it('carries a trailing partial line forward and completes it on the next chunk', () => {
    const first = splitLines('', 'first complete line\nsecond line starts')
    expect(first.lines).toEqual(['first complete line'])
    expect(first.remainder).toBe('second line starts')

    const second = splitLines(first.remainder, ' and finishes here\n')
    expect(second.lines).toEqual(['second line starts and finishes here'])
    expect(second.remainder).toBe('')
  })

  it('handles a chunk split in the middle of a multi-byte-looking word across calls', () => {
    const a = splitLines('', 'ERR')
    const b = splitLines(a.remainder, 'OR: boom\n')
    expect(b.lines).toEqual(['ERROR: boom'])
  })
})

describe('ERROR_PATTERN', () => {
  it.each([
    'ERROR: connection refused',
    'Uncaught exception in handler',
    'request failed with status 500',
    'FATAL: out of memory',
    'panic: runtime error',
    'HTTP 503 Service Unavailable',
  ])('flags "%s" as an alert', (line) => {
    expect(ERROR_PATTERN.test(line)).toBe(true)
  })

  it.each([
    'GET /api/users 200 OK',
    'Server listening on port 3000',
    'Build completed successfully',
  ])('does not flag "%s"', (line) => {
    expect(ERROR_PATTERN.test(line)).toBe(false)
  })
})
