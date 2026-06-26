import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { appendDeployRecord, listDeployRecords, type DeployRecord } from './deployHistory'

describe('deployHistory', () => {
  let projectPath = ''

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-deploy-history-'))
  })

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true })
  })

  const record = (overrides: Partial<Omit<DeployRecord, 'hash'>> = {}): Omit<DeployRecord, 'hash'> => ({
    id: 'id-1', ts: Date.now(), provider: 'vercel', deployCmd: 'vercel', target: 'preview', exitCode: 0, url: 'https://example.vercel.app',
    ...overrides,
  })

  it('returns an empty list when no history exists yet', () => {
    expect(listDeployRecords(projectPath)).toEqual([])
  })

  it('appends and lists a record, most recent first', () => {
    appendDeployRecord(projectPath, record({ id: 'id-1', ts: 1000 }))
    appendDeployRecord(projectPath, record({ id: 'id-2', ts: 2000 }))
    const list = listDeployRecords(projectPath)
    expect(list.map((r) => r.id)).toEqual(['id-2', 'id-1'])
  })

  it('chains hashes across records so each depends on the previous', () => {
    appendDeployRecord(projectPath, record({ id: 'id-1' }))
    appendDeployRecord(projectPath, record({ id: 'id-2' }))
    const [latest, prior] = listDeployRecords(projectPath)
    expect(latest.hash).toBeTruthy()
    expect(prior.hash).toBeTruthy()
    expect(latest.hash).not.toBe(prior.hash)
  })

  it('preserves promotedFromId and rolledBackFromId fields', () => {
    appendDeployRecord(projectPath, record({ id: 'id-1' }))
    appendDeployRecord(projectPath, record({ id: 'id-2', target: 'production', promotedFromId: 'id-1' }))
    const [promoted] = listDeployRecords(projectPath)
    expect(promoted.promotedFromId).toBe('id-1')
  })

  it('never throws even if the directory is unwritable', () => {
    expect(() => appendDeployRecord('/nonexistent/deeply/nested/path', record())).not.toThrow()
  })
})
