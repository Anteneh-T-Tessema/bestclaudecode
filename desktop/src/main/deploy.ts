import { promises as fs } from 'fs'
import * as path from 'path'
import { runCommand, type CommandResult } from './pythonBridge'

// Gap 140 — deploy detection/run logic shared between the autonomous agent's
// automatic end-of-session deploy (autonomousAgent.ts) and the manual
// "Deploy" button (deploy.handlers.ts). Kept here as the single source of
// truth so both callers detect/run deploys identically.

export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/)
  return m ? m[0] : null
}

/**
 * Detects a deploy command for `targetPath` in priority order: npm `deploy`
 * script, Vercel project, Netlify project. Returns null if none found.
 *
 * Both the Vercel and Netlify branches deploy to production (`--prod`), not
 * a preview URL — a deploy triggered either by the manual button or by the
 * autonomous agent at the end of a session is meant to produce a real,
 * shareable result, not a throwaway preview link.
 */
export async function detectDeployCommand(targetPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(targetPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    if (pkg.scripts?.deploy) return 'npm run deploy'
  } catch { /* no package.json or no deploy script */ }

  for (const candidate of ['vercel.json', '.vercel']) {
    try {
      await fs.access(path.join(targetPath, candidate))
      return 'vercel --prod'
    } catch { /* not found */ }
  }

  for (const candidate of ['netlify.toml', '.netlify']) {
    try {
      await fs.access(path.join(targetPath, candidate))
      return 'netlify deploy --prod'
    } catch { /* not found */ }
  }

  return null
}

export async function runDeploy(
  targetPath: string,
  deployCmd: string
): Promise<CommandResult & { deployUrl?: string }> {
  const result = await runCommand('/bin/sh', ['-c', deployCmd], targetPath)
  const combined = result.stdout + '\n' + result.stderr
  return { ...result, deployUrl: extractUrl(combined) ?? undefined }
}

export type DeployProvider = 'vercel' | 'netlify' | 'npm'

/** Vercel deployment URLs/ids are plain alphanumeric+dots+dashes — reject anything else before shell interpolation. */
function isSafeDeployIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._\-/:]+$/.test(value)
}

/** Derives the provider from the command string `detectDeployCommand` already returns — no extra fs checks needed. */
export function providerFromCommand(deployCmd: string): DeployProvider {
  if (deployCmd.startsWith('vercel')) return 'vercel'
  if (deployCmd.startsWith('netlify')) return 'netlify'
  return 'npm'
}

/**
 * Deploys a preview (not production) build. Vercel/Netlify both produce a
 * preview/draft URL when invoked without their production flag. There is no
 * preview concept for an arbitrary `npm run deploy` script — callers should
 * not call this for the 'npm' provider; fall back to `runDeploy` instead.
 */
export async function runPreviewDeploy(
  targetPath: string,
  provider: 'vercel' | 'netlify'
): Promise<CommandResult & { deployUrl?: string }> {
  const cmd = provider === 'vercel' ? 'vercel' : 'netlify deploy'
  const result = await runCommand('/bin/sh', ['-c', cmd], targetPath)
  const combined = result.stdout + '\n' + result.stderr
  return { ...result, deployUrl: extractUrl(combined) ?? undefined }
}

/**
 * Promotes a previously-deployed build to production. Vercel has a direct
 * `promote <url>` command. Netlify's CLI has no equivalent — this re-runs
 * `netlify deploy --prod` (a fresh prod deploy of the current HEAD, not a
 * promotion of the exact preview artifact); callers must label this
 * distinction honestly in the UI rather than imply it's a true promote.
 */
export async function promoteDeploy(
  targetPath: string,
  provider: 'vercel' | 'netlify',
  urlOrId: string
): Promise<CommandResult & { deployUrl?: string }> {
  if (provider === 'vercel' && !isSafeDeployIdentifier(urlOrId)) {
    return { stdout: '', stderr: 'Refused: deployment identifier contains unexpected characters', exitCode: -1 }
  }
  const cmd = provider === 'vercel' ? `vercel promote ${urlOrId}` : 'netlify deploy --prod'
  const result = await runCommand('/bin/sh', ['-c', cmd], targetPath)
  const combined = result.stdout + '\n' + result.stderr
  return { ...result, deployUrl: extractUrl(combined) ?? urlOrId }
}

/**
 * Rolls back production to a past deployment. Vercel-only — Netlify's CLI
 * has no clean rollback command, so callers must hide rollback UI for
 * Netlify/npm providers rather than fake a capability the CLI doesn't have.
 */
export async function rollbackDeploy(targetPath: string, urlOrId: string): Promise<CommandResult> {
  if (!isSafeDeployIdentifier(urlOrId)) {
    return { stdout: '', stderr: 'Refused: deployment identifier contains unexpected characters', exitCode: -1 }
  }
  return runCommand('/bin/sh', ['-c', `vercel rollback ${urlOrId}`], targetPath)
}
