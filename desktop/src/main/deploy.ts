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
