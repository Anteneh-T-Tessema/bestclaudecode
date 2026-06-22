import { spawn, execSync, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

const ROOT = path.resolve(__dirname, '..')
const PORT_FILE = path.join(ROOT, '.e2e-cdp-port')
export const CDP_PORT = 19_298 // distinct from legacyai-ide's 19297

// Guards against a previous crashed/killed run leaving an Electron instance
// bound to CDP_PORT, which silently blocks the next run's CDP connection.
function killStaleProcessOnPort(port: number): void {
  try {
    const pids = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8' }).trim()
    if (pids) {
      for (const pid of pids.split('\n')) {
        try { process.kill(parseInt(pid, 10), 'SIGKILL') } catch { /* already dead */ }
      }
    }
  } catch {
    // lsof exits non-zero when nothing is listening — nothing to clean up
  }
}

async function waitForCDP(port: number, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`Electron CDP not ready on port ${port} after ${timeout}ms`)
}

// Synthetic decision-log fixtures — never touches the real project's actual
// docs/decisions/ audit trail. See LAKOORA_DECISIONS_DIR in decisions.handlers.ts.
function seedDecisionFixtures(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })

  const entries: Array<{ name: string; content: string }> = [
    {
      name: '2026-01-01_000001_add-bm25-search-index.md',
      content:
        '# Decision: Add BM25 search index over repo map symbols\n\n' +
        '**Agent**: coding-agent  \n' +
        '**Retries**: 0  \n' +
        '**Verdict**: LGTM  \n' +
        '**Outcome**: Implemented BM25Index with Okapi scoring\n',
    },
    {
      name: '2026-01-02_000002_fix-cache-eviction.md',
      content:
        '# Decision: Fix LRU cache eviction edge case\n\n' +
        '**Agent**: coding-agent  \n' +
        '**Retries**: 1  \n' +
        '**Verdict**: Blocking: 2 issues fixed  \n' +
        '**Outcome**: Fixed off-by-one in atime comparison\n' +
        '## Reviewer findings\n\n' +
        '- Off-by-one in src/cache_manager.py:42 eviction check\n' +
        '- Missing test for the boundary: 50 files exactly\n',
    },
    {
      name: '2026-01-03_000003_add-task-planner.md',
      content:
        '# Decision: Add long-horizon task planner\n\n' +
        '**Agent**: coding-agent  \n' +
        '**Retries**: 0  \n' +
        '**Verdict**: Should-fix: 1 issue noted  \n' +
        '**Outcome**: Added TaskPlan with dependency-ordered subtasks\n' +
        '## Reviewer findings\n\n' +
        '- Docstring missing on src/task_planner.py:88 (minor, not blocking)\n',
    },
  ]

  for (const { name, content } of entries) {
    fs.writeFileSync(path.join(dir, name), content, 'utf-8')
  }
}

export default async function globalSetup() {
  killStaleProcessOnPort(CDP_PORT)

  // Isolated userData dir — keeps e2e runs from touching the developer's real
  // Electron app settings/state.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakoora-e2e-'))
  fs.writeFileSync(PORT_FILE + '.userdata', userDataDir, 'utf-8')

  // Isolated decision-log fixture dir — see seedDecisionFixtures() above.
  const decisionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakoora-e2e-decisions-'))
  seedDecisionFixtures(decisionsDir)
  fs.writeFileSync(PORT_FILE + '.decisions', decisionsDir, 'utf-8')

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    LAKOORA_CDP_PORT: String(CDP_PORT),
    LAKOORA_E2E_USER_DATA_DIR: userDataDir,
    LAKOORA_DECISIONS_DIR: decisionsDir,
  }
  // Electron must NOT run as a plain Node process, or require('electron') returns
  // the npm shim (binary path string) instead of the real API and the app crashes
  // at startup. See package.json "start"/"dev" scripts.
  delete env.ELECTRON_RUN_AS_NODE

  const proc: ChildProcess = spawn('npx', ['electron-vite', 'preview'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // detached so this process becomes its own group leader (pgid === pid).
    detached: true,
  })

  fs.writeFileSync(PORT_FILE, `${proc.pid}:${CDP_PORT}`, 'utf-8')

  await waitForCDP(CDP_PORT)
  await new Promise((r) => setTimeout(r, 1500))
}
