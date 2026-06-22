import { spawn } from 'child_process'
import * as fs from 'fs'
import { repoRoot, venvPython } from './paths'

export interface PythonBridgeResult {
  ok: boolean
  stats?: unknown
  error?: string
}

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Runs a one-off command to completion (not a pty) and captures its output — used for "Run Tests" from chat. */
export function runCommand(bin: string, args: string[], cwd?: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: cwd ?? repoRoot() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }))
    child.on('error', (err) => resolve({ stdout, stderr: err.message, exitCode: -1 }))
  })
}

/** Spawns `.venv/bin/python3 <args>` from repoRoot and parses stdout as JSON. */
export function runPythonJson(args: string[]): Promise<PythonBridgeResult> {
  return new Promise((resolve) => {
    const python = venvPython()
    if (!fs.existsSync(python)) {
      resolve({ ok: false, error: `Python interpreter not found at ${python}` })
      return
    }

    const child = spawn(python, args, { cwd: repoRoot() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `Exited with code ${code}` })
        return
      }
      try {
        resolve({ ok: true, stats: JSON.parse(stdout) })
      } catch {
        resolve({ ok: false, error: 'Failed to parse JSON output' })
      }
    })

    child.on('error', (err) => {
      resolve({ ok: false, error: err.message })
    })
  })
}
