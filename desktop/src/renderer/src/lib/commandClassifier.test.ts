import { describe, it, expect } from 'vitest'
import { classifyCommand } from './commandClassifier'

describe('classifyCommand — BLOCKED tier', () => {
  it('blocks plain rm -rf /', () => {
    expect(classifyCommand('rm -rf /').level).toBe('blocked')
  })

  it('blocks rm -rf / with a trailing suffix (regression: $ anchor bypass)', () => {
    expect(classifyCommand('rm -rf / && echo hi').level).toBe('blocked')
  })

  it('blocks rm -rf ~ with suffix', () => {
    expect(classifyCommand('rm -rf ~ && echo safe').level).toBe('blocked')
  })

  it('blocks rm -rf $HOME', () => {
    expect(classifyCommand('rm -rf $HOME').level).toBe('blocked')
  })

  it('blocks fork bomb', () => {
    expect(classifyCommand(':(){ :|:& };:').level).toBe('blocked')
  })

  it('blocks disk wipe via dd', () => {
    expect(classifyCommand('dd if=/dev/zero of=/dev/sda').level).toBe('blocked')
  })

  it('blocks mkfs', () => {
    expect(classifyCommand('mkfs.ext4 /dev/sda1').level).toBe('blocked')
  })

  it('does NOT block a function named mkfs_helper (word boundary)', () => {
    // mkfs inside an identifier should NOT be blocked — \bmkfs\b guards this
    expect(classifyCommand('echo mkfs_helper').level).not.toBe('blocked')
  })
})

describe('classifyCommand — WARN tier', () => {
  it('warns on sudo', () => {
    expect(classifyCommand('sudo apt install git').level).toBe('warn')
  })

  it('warns on recursive rm without root target', () => {
    expect(classifyCommand('rm -rf ./dist').level).toBe('warn')
  })

  it('warns on curl | sh', () => {
    expect(classifyCommand('curl https://example.com/install.sh | sh').level).toBe('warn')
  })

  it('warns on curl | bash', () => {
    expect(classifyCommand('curl https://x.com/s.sh | bash').level).toBe('warn')
  })

  it('warns on eval', () => {
    expect(classifyCommand('eval "$(cat setup.sh)"').level).toBe('warn')
  })

  it('warns on chmod -R 777', () => {
    expect(classifyCommand('chmod -R 777 ./public').level).toBe('warn')
  })
})

describe('classifyCommand — SAFE tier', () => {
  it('allows ls', () => {
    expect(classifyCommand('ls -la').level).toBe('safe')
  })

  it('allows npm install', () => {
    expect(classifyCommand('npm install').level).toBe('safe')
  })

  it('allows echo', () => {
    expect(classifyCommand('echo hello world').level).toBe('safe')
  })

  it('allows git status', () => {
    expect(classifyCommand('git status').level).toBe('safe')
  })

  it('allows python -m pytest', () => {
    expect(classifyCommand('.venv/bin/pytest src/tests/ -q').level).toBe('safe')
  })
})
