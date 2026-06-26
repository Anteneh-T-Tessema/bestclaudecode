import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { appendAlert, listAlerts, clearAlerts } from './monitorAlertLog'

describe('monitorAlertLog', () => {
  let projectPath = ''

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'meshflow-monitor-alerts-'))
  })

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true })
  })

  it('returns an empty list when no alerts have been recorded', () => {
    expect(listAlerts(projectPath)).toEqual([])
  })

  it('appends and lists alerts, most recent first', () => {
    appendAlert(projectPath, 'ERROR: first failure', 'mon-1')
    appendAlert(projectPath, 'ERROR: second failure', 'mon-1')
    const list = listAlerts(projectPath)
    expect(list).toHaveLength(2)
    expect(list[0].line).toBe('ERROR: second failure')
    expect(list[1].line).toBe('ERROR: first failure')
  })

  it('assigns a unique id and timestamp to each alert', () => {
    const a = appendAlert(projectPath, 'ERROR: a', 'mon-1')
    const b = appendAlert(projectPath, 'ERROR: b', 'mon-1')
    expect(a?.id).not.toBe(b?.id)
  })

  it('clears the log', () => {
    appendAlert(projectPath, 'ERROR: x', 'mon-1')
    clearAlerts(projectPath)
    expect(listAlerts(projectPath)).toEqual([])
  })

  it('clearAlerts is a no-op (not a throw) when no log exists', () => {
    expect(() => clearAlerts(projectPath)).not.toThrow()
  })
})
