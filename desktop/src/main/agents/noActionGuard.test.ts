/**
 * Agent no-action guard
 *
 * The fix: if a subtask response contains no <<<EDIT>>>, <<<RUN>>>, <<<BROWSE>>>,
 * or <<<SPAWN>>> blocks, the agent retries with a directive prompt rather than
 * marking the subtask done with no code written.
 *
 * These tests cover the block-parsing logic that drives the hasActions check.
 */
import { describe, it, expect } from 'vitest'

// Mirrors the regexes in autonomousAgent.ts exactly.
const EDIT_RE   = /<<<EDIT ([^\n>]+)>>>\n([\s\S]*?)\n<<<END_EDIT>>>/g
const RUN_RE    = /<<<RUN>>>\n([\s\S]*?)\n<<<END_RUN>>>/g
const BROWSE_RE = /<<<BROWSE ([^\n>]+)>>>\n([\s\S]*?)\n<<<END_BROWSE>>>/g
const SPAWN_RE  = /<<<SPAWN goal="([^"]+)">>>\n([\s\S]*?)\n<<<END_SPAWN>>>/g

function parseEdits(text: string)   { return [...text.matchAll(EDIT_RE)]   }
function parseRuns(text: string)    { return [...text.matchAll(RUN_RE)]    }
function parseBrowses(text: string) { return [...text.matchAll(BROWSE_RE)] }
function parseSpawns(text: string)  { return [...text.matchAll(SPAWN_RE)]  }

function hasActions(response: string): boolean {
  return (
    parseEdits(response).length > 0 ||
    parseRuns(response).length > 0 ||
    parseBrowses(response).length > 0 ||
    parseSpawns(response).length > 0
  )
}

// ── Prose-only responses (the bug scenario) ───────────────────────────────────

describe('hasActions — prose-only responses return false', () => {
  it('returns false for a plain-text explanation', () => {
    expect(hasActions('I will implement this by using git log to parse commits.')).toBe(false)
  })

  it('returns false for an empty response', () => {
    expect(hasActions('')).toBe(false)
  })

  it('returns false for a markdown-formatted response with no blocks', () => {
    const prose = `## Plan\n\n1. Parse git log\n2. Group by author\n3. Count lines\n\nThis approach is clean and efficient.`
    expect(hasActions(prose)).toBe(false)
  })

  it('returns false for a response with backtick code blocks (not EDIT blocks)', () => {
    const response = `Here is the code:\n\`\`\`python\nprint("hello")\n\`\`\``
    expect(hasActions(response)).toBe(false)
  })
})

// ── EDIT blocks ───────────────────────────────────────────────────────────────

describe('hasActions — EDIT blocks return true', () => {
  it('detects a single EDIT block', () => {
    const response = `<<<EDIT src/git_blame.py>>>\nprint("hello")\n<<<END_EDIT>>>`
    expect(hasActions(response)).toBe(true)
  })

  it('detects multiple EDIT blocks', () => {
    const response = [
      `<<<EDIT src/git_blame.py>>>\ndef blame(): pass\n<<<END_EDIT>>>`,
      `<<<EDIT src/tests/test_git_blame.py>>>\ndef test_blame(): pass\n<<<END_EDIT>>>`,
    ].join('\n')
    expect(hasActions(response)).toBe(true)
  })

  it('parses the file path correctly', () => {
    const response = `<<<EDIT src/commands/git_blame.py>>>\ncontent\n<<<END_EDIT>>>`
    const edits = parseEdits(response)
    expect(edits[0][1]).toBe('src/commands/git_blame.py')
  })

  it('parses multi-line file content correctly', () => {
    const content = `import subprocess\n\ndef run():\n    pass`
    const response = `<<<EDIT src/git_blame.py>>>\n${content}\n<<<END_EDIT>>>`
    const edits = parseEdits(response)
    expect(edits[0][2]).toBe(content)
  })
})

// ── RUN blocks ────────────────────────────────────────────────────────────────

describe('hasActions — RUN blocks return true', () => {
  it('detects a RUN block', () => {
    const response = `<<<RUN>>>\n.venv/bin/pytest src/tests/ -q\n<<<END_RUN>>>`
    expect(hasActions(response)).toBe(true)
  })

  it('parses the command correctly', () => {
    const response = `<<<RUN>>>\necho hello\n<<<END_RUN>>>`
    const runs = parseRuns(response)
    expect(runs[0][1].trim()).toBe('echo hello')
  })
})

// ── BROWSE blocks ─────────────────────────────────────────────────────────────

describe('hasActions — BROWSE blocks return true', () => {
  it('detects a BROWSE block', () => {
    const response = `<<<BROWSE https://docs.python.org/3/library/subprocess.html>>>\nFind the Popen API signature\n<<<END_BROWSE>>>`
    expect(hasActions(response)).toBe(true)
  })
})

// ── SPAWN blocks ──────────────────────────────────────────────────────────────

describe('hasActions — SPAWN blocks return true', () => {
  it('detects a SPAWN block', () => {
    const response = `<<<SPAWN goal="Write tests for git blame">>>\nFocus on edge cases\n<<<END_SPAWN>>>`
    expect(hasActions(response)).toBe(true)
  })
})

// ── Mixed responses ───────────────────────────────────────────────────────────

describe('hasActions — mixed prose + blocks return true', () => {
  it('returns true when prose precedes an EDIT block', () => {
    const response = `Here is the implementation:\n\n<<<EDIT src/git_blame.py>>>\ncode\n<<<END_EDIT>>>`
    expect(hasActions(response)).toBe(true)
  })

  it('returns true when response has both EDIT and RUN blocks', () => {
    const response = [
      `<<<EDIT src/git_blame.py>>>\ndef blame(): pass\n<<<END_EDIT>>>`,
      `<<<RUN>>>\n.venv/bin/pytest src/tests/test_git_blame.py -q\n<<<END_RUN>>>`,
    ].join('\n')
    expect(hasActions(response)).toBe(true)
    expect(parseEdits(response)).toHaveLength(1)
    expect(parseRuns(response)).toHaveLength(1)
  })
})
