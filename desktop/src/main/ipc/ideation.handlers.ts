import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import { store } from '../store'
import { repoRoot } from '../paths'
import { extractDesignTokens, type DesignTokens } from './design.handlers'

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

/**
 * Formats a task description for the *existing* coding-agent pipeline —
 * this is the entire "generation" step. No component code is produced here;
 * the prompt + extracted design tokens are just assembled into the same
 * shape of task description a human would type into Task Planner, so the
 * actual write goes through the existing worktree-isolation + review +
 * decision-log path rather than a second, ungoverned generation path.
 */
export function buildComponentTask(prompt: string, tokens: DesignTokens | null): string {
  const lines = [`Generate a React component for: ${prompt.trim()}`]
  if (tokens && (tokens.tailwindConfig || Object.keys(tokens.cssVars).length || tokens.themeFiles.length)) {
    lines.push('', 'Match this project\'s existing design tokens:')
    if (tokens.tailwindConfig) lines.push('', 'Tailwind config:', '```', tokens.tailwindConfig, '```')
    if (Object.keys(tokens.cssVars).length) {
      lines.push('', 'CSS custom properties:', ...Object.entries(tokens.cssVars).map(([k, v]) => `- ${k}: ${v}`))
    }
    for (const theme of tokens.themeFiles) {
      lines.push('', `Theme file (${theme.file}):`, '```', theme.excerpt, '```')
    }
  } else {
    lines.push('', 'No existing design tokens were found in this project — use sensible defaults.')
  }
  return lines.join('\n')
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

  // Zero-to-one scaffolding, first slice: builds a task description (prompt +
  // extracted design tokens) for the *existing* coding-agent pipeline. The
  // renderer hands the returned string straight to the same agent-invocation
  // plumbing /implement-equivalent runs already use — no new write path.
  ipcMain.handle('ideation:generateComponent', async (
    _event,
    projectPath: string,
    prompt: string,
  ): Promise<{ taskDescription: string } | null> => {
    if (!prompt.trim()) return null
    const tokens = await extractDesignTokens(projectPath)
    return { taskDescription: buildComponentTask(prompt, tokens) }
  })
}
