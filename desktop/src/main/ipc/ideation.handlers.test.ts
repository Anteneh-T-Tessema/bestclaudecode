/**
 * Ideation: saveSpec / listSpecs / readSpec IPC handlers.
 * Specs are project-scoped under <projectPath>/.meshflow/specs/<slug>.md,
 * so the store mock points projectPath at a real temp dir and the handlers
 * exercise real fs I/O against it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
let projectPath = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      registeredHandlers.set(channel, handler)
    },
  },
}))

vi.mock('../store', () => ({
  store: {
    get: (key: string) => (key === 'projectPath' ? projectPath : undefined),
  },
}))

import { registerIdeationHandlers, buildComponentTask } from './ideation.handlers'

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const h = registeredHandlers.get(channel)
  if (!h) throw new Error(`No handler registered for: ${channel}`)
  return Promise.resolve(h({} /* _event */, ...args))
}

describe('ideation IPC handlers', () => {
  beforeEach(async () => {
    registeredHandlers.clear()
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'meshflow-ideation-'))
    registerIdeationHandlers()
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it('saveSpec writes the markdown under .meshflow/specs/<slug>.md and returns its path', async () => {
    const result = (await invoke('ideation:saveSpec', 'my-feature', '# My Feature\n\nDetails.')) as {
      path: string
    } | null
    expect(result).not.toBeNull()
    const expectedPath = path.join(projectPath, '.meshflow', 'specs', 'my-feature.md')
    expect(result!.path).toBe(expectedPath)
    expect(await fs.readFile(expectedPath, 'utf-8')).toBe('# My Feature\n\nDetails.')
  })

  it('saveSpec creates the specs directory when it does not exist yet', async () => {
    const dir = path.join(projectPath, '.meshflow', 'specs')
    await expect(fs.access(dir)).rejects.toThrow()
    await invoke('ideation:saveSpec', 'new-dir', 'content')
    await expect(fs.access(dir)).resolves.toBeUndefined()
  })

  it('readSpec returns the saved markdown for a known slug', async () => {
    await invoke('ideation:saveSpec', 'readback', '## Spec body')
    const read = await invoke('ideation:readSpec', 'readback')
    expect(read).toBe('## Spec body')
  })

  it('readSpec returns null for a slug that was never saved', async () => {
    const read = await invoke('ideation:readSpec', 'does-not-exist')
    expect(read).toBeNull()
  })

  it('listSpecs returns an empty array when no specs exist yet', async () => {
    const specs = await invoke('ideation:listSpecs')
    expect(specs).toEqual([])
  })

  it('listSpecs returns saved specs sorted newest-first by mtime', async () => {
    await invoke('ideation:saveSpec', 'older', 'first')
    await new Promise((r) => setTimeout(r, 5))
    await invoke('ideation:saveSpec', 'newer', 'second')

    const specs = (await invoke('ideation:listSpecs')) as Array<{
      slug: string
      path: string
      mtime: number
    }>
    expect(specs.map((s) => s.slug)).toEqual(['newer', 'older'])
    expect(specs[0].path).toBe(path.join(projectPath, '.meshflow', 'specs', 'newer.md'))
  })

  it('listSpecs ignores non-markdown files in the specs directory', async () => {
    await invoke('ideation:saveSpec', 'real-spec', 'content')
    const dir = path.join(projectPath, '.meshflow', 'specs')
    await fs.writeFile(path.join(dir, 'notes.txt'), 'not a spec')

    const specs = (await invoke('ideation:listSpecs')) as Array<{ slug: string }>
    expect(specs.map((s) => s.slug)).toEqual(['real-spec'])
  })

  it('saveSpec returns null when the write fails (e.g. unwritable target)', async () => {
    const realProjectPath = projectPath
    // Point at a file (not a directory) so mkdir-ing .meshflow/specs under it fails.
    const blockingFile = path.join(realProjectPath, 'blocker')
    await fs.writeFile(blockingFile, 'not a directory')
    projectPath = blockingFile

    const result = await invoke('ideation:saveSpec', 'broken', 'content')
    expect(result).toBeNull()

    projectPath = realProjectPath
  })

  describe('generateComponent (zero-to-one scaffolding, first slice)', () => {
    it('returns null for a blank prompt without touching the filesystem', async () => {
      const result = await invoke('ideation:generateComponent', projectPath, '   ')
      expect(result).toBeNull()
    })

    it('builds a task description embedding the prompt and the project\'s tailwind config', async () => {
      await fs.writeFile(path.join(projectPath, 'tailwind.config.js'), 'module.exports = { theme: { colors: { brand: "#ff0000" } } }')

      const result = (await invoke(
        'ideation:generateComponent',
        projectPath,
        'a pricing card with three tiers',
      )) as { taskDescription: string } | null

      expect(result).not.toBeNull()
      expect(result!.taskDescription).toContain('Generate a React component for: a pricing card with three tiers')
      expect(result!.taskDescription).toContain('brand: "#ff0000"')
    })

    it('falls back to "use sensible defaults" when no design tokens exist in the project', async () => {
      const result = (await invoke(
        'ideation:generateComponent',
        projectPath,
        'a simple footer',
      )) as { taskDescription: string } | null

      expect(result).not.toBeNull()
      expect(result!.taskDescription).toContain('No existing design tokens were found')
    })
  })
})

describe('buildComponentTask (pure)', () => {
  it('embeds CSS custom properties and theme file excerpts when present', () => {
    const task = buildComponentTask('a nav bar', {
      tailwindConfig: null,
      cssVars: { '--brand-color': '#123456' },
      themeFiles: [{ file: 'src/theme.ts', excerpt: 'export const theme = {}' }],
    })
    expect(task).toContain('Generate a React component for: a nav bar')
    expect(task).toContain('--brand-color: #123456')
    expect(task).toContain('src/theme.ts')
    expect(task).toContain('export const theme = {}')
  })

  it('uses the sensible-defaults fallback when tokens is null', () => {
    const task = buildComponentTask('a footer', null)
    expect(task).toContain('No existing design tokens were found')
  })

  it('trims the prompt', () => {
    const task = buildComponentTask('  a button  ', null)
    expect(task).toContain('Generate a React component for: a button')
  })
})
