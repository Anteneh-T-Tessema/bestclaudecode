// Hard-blocked: patterns so destructive there's no safe use case from an AI proposal.
// No trailing $ anchors — suffixed commands like `rm -rf / && echo hi` must still be caught.
export const BLOCKED_PATTERNS = [
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(\/|~|\$HOME|\$\{HOME\})/i,  // rm -rf / or rm -rf ~
  /:\(\)\s*\{\s*:|:\s*&\s*\}/,                                  // fork bomb
  /dd\s+if=\/dev\/zero\s+of=\/dev\//i,                         // disk wipe
  /\bmkfs\b/i,                                                   // filesystem format (word-bounded)
  /format\s+[a-z]:/i,                                           // Windows format drive
]

// Warn-then-confirm: potentially dangerous but may be legitimate.
export const WARN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bsudo\b/,                              reason: 'runs with elevated privileges' },
  { re: /rm\s+-[a-zA-Z]*r[a-zA-Z]*/i,           reason: 'recursive delete' },
  { re: /\|\s*(ba|z|da|fi)?sh\b/,               reason: 'pipes output directly into a shell' },
  { re: /curl\b.*\|\s*\w*sh\b/i,                reason: 'downloads and executes remote code' },
  { re: /wget\b.*\|\s*\w*sh\b/i,                reason: 'downloads and executes remote code' },
  { re: /python3?\s+-c\b|node\s+-e\b/i,         reason: 'executes code from a string argument' },
  { re: /eval\s+/,                               reason: 'evaluates a dynamically constructed string' },
  { re: /chmod\s+-R\s+777/i,                     reason: 'makes files world-writable recursively' },
]

export type DangerLevel = 'safe' | 'warn' | 'blocked'

export function classifyCommand(cmd: string): { level: DangerLevel; reason?: string } {
  if (BLOCKED_PATTERNS.some((re) => re.test(cmd))) {
    return { level: 'blocked', reason: 'this command is too destructive to allow from an AI proposal' }
  }
  for (const { re, reason } of WARN_PATTERNS) {
    if (re.test(cmd)) return { level: 'warn', reason }
  }
  return { level: 'safe' }
}
