import * as path from 'path'
import { runCommand } from './pythonBridge'

/**
 * Write content to a temp file, run `tsc --noEmit` on it, and return any
 * type errors as a string. Returns null if the file passes validation.
 * The temp file is deleted in a finally block regardless of outcome.
 */
export async function validateGeneratedTs(content: string, absPath: string): Promise<string | null> {
  const tmpPath = absPath + '.meshflow-tmp.ts'
  const { promises: fsp } = await import('fs')

  try {
    await fsp.writeFile(tmpPath, content, 'utf-8')

    // Prefer the project's own tsc; fall back to the desktop workspace's tsc.
    const projectRoot = absPath.includes('node_modules')
      ? path.dirname(absPath)
      : _findProjectRoot(absPath)
    const tscBin = path.join(projectRoot, 'node_modules', '.bin', 'tsc')

    const result = await runCommand(tscBin, [
      '--noEmit',
      '--skipLibCheck',
      '--allowJs',
      '--target', 'ES2020',
      '--moduleResolution', 'node',
      tmpPath,
    ])

    if (result.exitCode !== 0) {
      const errors = (result.stderr || result.stdout).trim()
      return errors ? errors.slice(0, 800) : `tsc exited with code ${result.exitCode}`
    }
    return null
  } finally {
    fsp.unlink(tmpPath).catch(() => { /* best-effort cleanup */ })
  }
}

function _findProjectRoot(filePath: string): string {
  let dir = path.dirname(filePath)
  for (let i = 0; i < 8; i++) {
    try {
      require('fs').accessSync(path.join(dir, 'package.json'))
      return dir
    } catch {
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return path.dirname(filePath)
}
