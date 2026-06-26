/**
 * Gap 3 — Integrated Preview URL Deployments
 * Tests the preview deploy helpers in deploy.ts that back the auto-preview flow.
 */
import { describe, it, expect } from 'vitest'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { detectDeployCommand, providerFromCommand, extractUrl, runPreviewDeploy } from './deploy'

// ── extractUrl ─────────────────────────────────────────────────────────────────
describe('Gap 3 — extractUrl', () => {
  it('extracts a Vercel preview URL from stdout', () => {
    const output = 'Deploying to Vercel...\nhttps://myapp-abc123.vercel.app\nDone!'
    expect(extractUrl(output)).toBe('https://myapp-abc123.vercel.app')
  })

  it('extracts a Netlify draft URL', () => {
    const output = 'Deploy URL: https://deploy-preview-42--mysite.netlify.app'
    expect(extractUrl(output)).toBe('https://deploy-preview-42--mysite.netlify.app')
  })

  it('returns null when there is no URL', () => {
    expect(extractUrl('Build failed: missing env var')).toBeNull()
  })

  it('returns the first URL when multiple are present', () => {
    const output = 'Inspect: https://vercel.com/inspect/abc Preview: https://preview.vercel.app'
    expect(extractUrl(output)).toBe('https://vercel.com/inspect/abc')
  })
})

// ── providerFromCommand ────────────────────────────────────────────────────────
describe('Gap 3 — providerFromCommand (preview path)', () => {
  it('correctly identifies vercel command', () => {
    expect(providerFromCommand('vercel')).toBe('vercel')
  })

  it('correctly identifies netlify command', () => {
    expect(providerFromCommand('netlify deploy')).toBe('netlify')
  })
})

// ── detectDeployCommand ────────────────────────────────────────────────────────
describe('Gap 3 — detectDeployCommand for Vercel/Netlify preview detection', () => {
  let tmpDir = ''

  it('detects a .vercel directory and returns vercel command', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-preview-vercel-'))
    fs.mkdirSync(path.join(tmpDir, '.vercel'))
    const cmd = await detectDeployCommand(tmpDir)
    expect(cmd).toBe('vercel --prod')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('detects a netlify.toml and returns netlify command', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-preview-netlify-'))
    fs.writeFileSync(path.join(tmpDir, 'netlify.toml'), '[build]\n  command = "npm run build"\n')
    const cmd = await detectDeployCommand(tmpDir)
    expect(cmd).toBe('netlify deploy --prod')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null for a plain directory with no deploy config', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-preview-none-'))
    const cmd = await detectDeployCommand(tmpDir)
    expect(cmd).toBeNull()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('prefers npm run deploy over Vercel if package.json deploy script exists', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-preview-npm-'))
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { deploy: 'node deploy.js' } })
    )
    fs.mkdirSync(path.join(tmpDir, '.vercel'))
    const cmd = await detectDeployCommand(tmpDir)
    expect(cmd).toBe('npm run deploy')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

// ── runPreviewDeploy — CLI-unavailable fast-fail ─────────────────────────────
describe('Gap 3 — runPreviewDeploy (CLI not installed fast-fail)', () => {
  const tmp = os.tmpdir()

  it('returns a non-zero exit code when vercel CLI is not installed', async () => {
    // vercel CLI is not installed in this environment — fails fast with
    // "command not found", giving us a real CommandResult to assert on.
    const result = await runPreviewDeploy(tmp, 'vercel')
    expect(result.exitCode).not.toBe(0)
    expect(typeof result.stdout + typeof result.stderr).toContain('string')
  }, 15000)

  it('returns a non-zero exit code when netlify CLI is not installed', async () => {
    const result = await runPreviewDeploy(tmp, 'netlify')
    expect(result.exitCode).not.toBe(0)
  }, 15000)
})
