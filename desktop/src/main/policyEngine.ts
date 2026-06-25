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
  /**
   * Gap 142 loose end — max retry attempts per subtask before the autonomous
   * agent blocks instead of giving up after one. Unlike the three array
   * fields above (where "empty" means "no restriction"), an absent/invalid
   * value here defaults to 3, not 0 — a missing policy file should still
   * retry, not give up immediately.
   */
  max_retries: number
  /** Run tsc --noEmit on generated .ts/.tsx files before writing them to disk. */
  require_type_check?: boolean
  /** Block any single EDIT block whose line count exceeds this limit. */
  max_edit_lines?: number
  /** Auto-reject a pending-approval request after this many minutes. */
  approval_timeout_minutes?: number
  /** Paths (globs) that trigger an inline security review on edit. */
  auto_review_paths?: string[]
}

const DEFAULT_MAX_RETRIES = 3

const EMPTY_POLICY: PolicyConfig = {
  block_commands: [],
  block_paths: [],
  require_approval_for: [],
  max_retries: DEFAULT_MAX_RETRIES,
  require_type_check: false,
  max_edit_lines: undefined,
  approval_timeout_minutes: undefined,
  auto_review_paths: [],
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
      max_retries: typeof parsed.max_retries === 'number' && parsed.max_retries > 0
        ? Math.floor(parsed.max_retries)
        : DEFAULT_MAX_RETRIES,
      require_type_check: parsed.require_type_check === true,
      max_edit_lines: typeof parsed.max_edit_lines === 'number' && parsed.max_edit_lines > 0
        ? Math.floor(parsed.max_edit_lines)
        : undefined,
      approval_timeout_minutes: typeof parsed.approval_timeout_minutes === 'number' && parsed.approval_timeout_minutes > 0
        ? parsed.approval_timeout_minutes
        : undefined,
      auto_review_paths: asStringArray(parsed.auto_review_paths),
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
export function globToRegex(glob: string): RegExp {
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
