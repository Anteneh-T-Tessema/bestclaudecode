import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface DesignTokens {
  tailwindConfig: string | null
  cssVars: Record<string, string>
  themeFiles: Array<{ file: string; excerpt: string }>
}

function extractCssVars(content: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const re = /--([\w-]+)\s*:\s*([^;}\n]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    vars[`--${m[1]}`] = m[2].trim()
  }
  return vars
}

function findThemeFiles(root: string): string[] {
  const candidates: string[] = []
  const NAMES = ['theme', 'tokens', 'colors', 'design-tokens', 'variables']
  const EXTS = ['.ts', '.tsx', '.js', '.css', '.json']

  function walk(dir: string, depth: number): void {
    if (depth > 4) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full, depth + 1); continue }
      const base = path.basename(e.name, path.extname(e.name)).toLowerCase()
      if (NAMES.some((n) => base.includes(n)) && EXTS.includes(path.extname(e.name))) {
        candidates.push(full)
      }
    }
  }
  walk(root, 0)
  return candidates.slice(0, 6)
}

export function registerDesignHandlers(): void {
  ipcMain.handle('design:extract', async (_event, projectPath: string): Promise<DesignTokens | null> => {
    if (!projectPath) return null
    try {
      // Tailwind config
      let tailwindConfig: string | null = null
      for (const name of ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs']) {
        const p = path.join(projectPath, name)
        if (fs.existsSync(p)) {
          tailwindConfig = fs.readFileSync(p, 'utf-8').slice(0, 3000)
          break
        }
      }

      // CSS custom properties from global stylesheets
      const cssVars: Record<string, string> = {}
      for (const name of ['globals.css', 'global.css', 'index.css', 'variables.css', 'styles.css']) {
        for (const dir of ['src', 'styles', 'app', '.']) {
          const p = path.join(projectPath, dir, name)
          if (fs.existsSync(p)) {
            Object.assign(cssVars, extractCssVars(fs.readFileSync(p, 'utf-8')))
            break
          }
        }
      }

      // Theme/token files
      const themeFilePaths = findThemeFiles(projectPath)
      const themeFiles = themeFilePaths.map((f) => ({
        file: path.relative(projectPath, f),
        excerpt: fs.readFileSync(f, 'utf-8').slice(0, 800),
      }))

      return { tailwindConfig, cssVars, themeFiles }
    } catch {
      return null
    }
  })
}
