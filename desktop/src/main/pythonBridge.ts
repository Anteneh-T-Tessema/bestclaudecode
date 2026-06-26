import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { repoRoot, venvPython } from './paths'
import { store } from './store'

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
    const useSandboxExec = store.get('useSandboxExec') as string
    let finalBin = bin
    let finalArgs = args
    let tempProfilePath: string | null = null
    const usingDocker = useSandboxExec === 'docker'

    if (usingDocker) {
      // Cross-platform, process+filesystem-level isolation — the workspace
      // dir is the *only* host path the container can see, and the container
      // is removed on exit. This is the meaningful tier above sandbox-exec
      // (macOS-only, ambient-permission restriction on the same host
      // process): the command runs in a different filesystem/process
      // namespace entirely, not just a more restricted view of this one.
      const workspace = cwd ?? repoRoot()
      const image = (store.get('dockerSandboxImage') as string) || 'node:22-bookworm'
      finalBin = 'docker'
      finalArgs = ['run', '--rm', '-v', `${workspace}:${workspace}`, '-w', workspace, image, bin, ...args]
    } else if (process.platform === 'darwin' && useSandboxExec && useSandboxExec !== 'never') {
      const workspace = cwd ?? repoRoot()
      if (useSandboxExec === 'no-network') {
        finalArgs = ['-n', 'no-network', bin, ...args]
        finalBin = 'sandbox-exec'
      } else if (useSandboxExec === 'restrict-write') {
        const profileContent = `(version 1)
(allow default)
(deny file-write*
  (subpath "/System")
  (subpath "/Library")
  (subpath "/usr")
  (subpath "/private/var")
  (subpath "/private/etc")
)
(allow file-write*
  (subpath "${workspace}")
  (subpath "/private/tmp")
  (subpath "/tmp")
)`
        tempProfilePath = path.join(os.tmpdir(), `meshflow_sandbox_${Date.now()}_${Math.random().toString(36).slice(2)}.sb`)
        try {
          fs.writeFileSync(tempProfilePath, profileContent, 'utf-8')
          finalArgs = ['-f', tempProfilePath, bin, ...args]
          finalBin = 'sandbox-exec'
        } catch (e) {
          console.error('Failed to write sandbox profile:', e)
        }
      }
    }

    const child = spawn(finalBin, finalArgs, { cwd: cwd ?? repoRoot() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    
    child.on('close', (code) => {
      if (tempProfilePath) {
        fs.unlink(tempProfilePath, () => {})
      }
      resolve({ stdout, stderr, exitCode: code ?? -1 })
    })
    
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (tempProfilePath) {
        fs.unlink(tempProfilePath, () => {})
      }
      // Docker sandbox requested but unavailable — fail the command outright
      // rather than silently re-running it unsandboxed. A missing/unreachable
      // Docker is a configuration problem the user needs to see and fix, not
      // a reason to quietly drop the isolation guarantee.
      const message = usingDocker && err.code === 'ENOENT'
        ? 'Docker sandbox is enabled (Settings → Sandboxing) but the `docker` command was not found. Install Docker or switch the sandbox mode.'
        : err.message
      resolve({ stdout, stderr: message, exitCode: -1 })
    })
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
