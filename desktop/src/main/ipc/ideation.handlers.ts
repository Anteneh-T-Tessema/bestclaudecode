import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import { store } from '../store'
import { repoRoot } from '../paths'

// Specs are project-scoped (<projectPath>/.meshflow/specs/<slug>.md), distinct
// from plans which always live under <repoRoot>/plans/ regardless of which
// project is open (runPythonJson always runs with cwd: repoRoot()). That
// asymmetry already exists elsewhere in the app; the spec's frontmatter
// records the plan file path it produced so an old spec can still be traced
// to its plan even though the two live in different trees.

function specsDir(): string {
  const projectPath = (store.get('projectPath') as string | undefined) || repoRoot()
  return path.join(projectPath, '.meshflow', 'specs')
}

export function registerIdeationHandlers(): void {
  ipcMain.handle('ideation:saveSpec', async (_event, slug: string, markdown: string): Promise<{ path: string } | null> => {
    try {
      const dir = specsDir()
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `${slug}.md`)
      await fs.writeFile(filePath, markdown, 'utf-8')
      return { path: filePath }
    } catch {
      return null
    }
  })

  ipcMain.handle('ideation:listSpecs', async (): Promise<Array<{ slug: string; path: string; mtime: number }>> => {
    try {
      const dir = specsDir()
      const files = await fs.readdir(dir)
      const specs = await Promise.all(
        files.filter((f) => f.endsWith('.md')).map(async (f) => {
          const filePath = path.join(dir, f)
          const stat = await fs.stat(filePath)
          return { slug: f.replace(/\.md$/, ''), path: filePath, mtime: stat.mtimeMs }
        })
      )
      return specs.sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  })

  ipcMain.handle('ideation:readSpec', async (_event, slug: string): Promise<string | null> => {
    try {
      return await fs.readFile(path.join(specsDir(), `${slug}.md`), 'utf-8')
    } catch {
      return null
    }
  })
}
