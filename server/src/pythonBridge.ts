// Shared path constants and Python subprocess helper used by both
// search.handlers.ts and ai.handlers.ts. The 4-level ascent is correct
// for the compiled output path:  dist/src/ -> dist/ -> server/ -> repo root.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
export const VENV_PYTHON = path.join(REPO_ROOT, '.venv', 'bin', 'python')

export interface PythonJsonResult {
  docCount: number
  avgDl: number
  results: Array<{ score: number; file: string; line: string }>
  backend?: string
  [key: string]: unknown
}

export function runPythonJson(args: string[]): Promise<PythonJsonResult> {
  return new Promise((resolve) => {
    const proc = spawn(VENV_PYTHON, args, { cwd: REPO_ROOT })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', () => {
      try {
        resolve(JSON.parse(stdout) as PythonJsonResult)
      } catch {
        resolve({ docCount: 0, avgDl: 0, results: [] })
      }
    })
    proc.on('error', () => resolve({ docCount: 0, avgDl: 0, results: [] }))
  })
}
