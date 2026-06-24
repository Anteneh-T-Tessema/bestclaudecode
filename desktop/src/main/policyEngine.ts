/**
 * User-configurable governance policy for the autonomous agent — read from
 * <projectPath>/.lakoorapolicies.json. Layered on top of (not replacing) the
 * hardcoded destructive-command blocklist in autonomousAgent.ts: this engine
 * is for project-specific rules a team wants enforced and auditable, e.g.
 * blocking edits to secret files or requiring approval before a deploy.
 */

import * as fs from 'fs'
import * as path from 'path'

export interface PolicyConfig {
  block_commands: string[]
  block_paths: string[]
  require_approval_for: string[]
}

const EMPTY_POLICY: PolicyConfig = {
  block_commands: [],
  block_paths: [],
  require_approval_for: [],
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** Reads and validates .lakoorapolicies.json from the project root. Returns an empty (no-op) policy if missing or invalid. */
export function loadPolicy(projectPath: string): PolicyConfig {
  try {
    const raw = fs.readFileSync(path.join(projectPath, '.lakoorapolicies.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      block_commands: asStringArray(parsed.block_commands),
      block_paths: asStringArray(parsed.block_paths),
      require_approval_for: asStringArray(parsed.require_approval_for),
    }
  } catch {
    return EMPTY_POLICY
  }
}

export interface PolicyViolation {
  rule: 'block_command' | 'block_path' | 'require_approval'
  pattern: string
  subject: string
}

/** Converts a simple glob (`*` wildcard only) into a regex matching the whole path or its tail after a `/`. */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .split('*')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`(^|/)${escaped}$`)
}

export function checkCommand(policy: PolicyConfig, command: string): PolicyViolation | null {
  for (const pattern of policy.block_commands) {
    if (new RegExp(pattern, 'i').test(command)) {
      return { rule: 'block_command', pattern, subject: command }
    }
  }
  return null
}

export function checkPath(policy: PolicyConfig, relPath: string): PolicyViolation | null {
  for (const pattern of policy.block_paths) {
    if (globToRegex(pattern).test(relPath)) {
      return { rule: 'block_path', pattern, subject: relPath }
    }
  }
  return null
}

export function checkApproval(policy: PolicyConfig, text: string): PolicyViolation | null {
  for (const pattern of policy.require_approval_for) {
    if (new RegExp(pattern, 'i').test(text)) {
      return { rule: 'require_approval', pattern, subject: text }
    }
  }
  return null
}
