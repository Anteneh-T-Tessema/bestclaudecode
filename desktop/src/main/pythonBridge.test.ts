import { describe, it, expect, vi } from 'vitest'
import * as os from 'os'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}))

vi.mock('./paths', () => ({
  repoRoot: () => os.tmpdir(),
  venvPython: () => 'python3',
}))

import { runCommand } from './pythonBridge'
import { store } from './store'

describe('runCommand sandboxing', () => {
  it('executes a command normally when sandbox is disabled', async () => {
    store.set('useSandboxExec', 'never')
    const result = await runCommand('echo', ['hello'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
  })

  if (process.platform === 'darwin') {
    it('blocks network connections under no-network sandbox', async () => {
      store.set('useSandboxExec', 'no-network')
      // We check if running curl fails under no-network sandbox
      const result = await runCommand('curl', ['--max-time', '2', 'https://github.com'])
      expect(result.exitCode).not.toBe(0)
    })

    it('blocks writes outside workspace under restrict-write sandbox', async () => {
      store.set('useSandboxExec', 'restrict-write')
      
      // Creating a directory in an allowed path (/tmp) should succeed
      const allowedResult = await runCommand('mkdir', ['-p', '/private/tmp/meshflow-test-sandbox-allowed'])
      expect(allowedResult.exitCode).toBe(0)

      // Creating a directory in a disallowed path (/Library) should fail with non-zero exit code
      const deniedResult = await runCommand('mkdir', ['-p', '/Library/meshflow-deny-test-dir'])
      expect(deniedResult.exitCode).not.toBe(0)
    })
  }
})
