import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import { Dirent } from 'fs'
import * as fsSync from 'fs'
import * as path from 'path'
import { store } from '../store'
import { repoRoot } from '../paths'
import { loadIgnoreRules, isIgnored } from '../ignoreRules'

interface FlatEntry {
  name: string
  path: string
  isDirectory: boolean
}

const IGNORE_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store', '.idea'])
const MAX_READ_BYTES = 5 * 1024 * 1024

function projectRoot(): string {
  return path.resolve((store.get('projectPath') as string | undefined) || repoRoot())
}

function assertInProject(p: string): void {
  const root = projectRoot()
  const resolved = path.resolve(p)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Access denied: "${p}" is outside the project root`)
  }
}

async function listDir(dirPath: string): Promise<FlatEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const root = projectRoot()
  const rules = loadIgnoreRules(root)
  return entries
    .filter((entry) => !IGNORE_DIRS.has(entry.name))
    .filter((entry) => !isIgnored(path.relative(root, path.join(dirPath, entry.name)), rules))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

const watchers = new Map<string, fsSync.FSWatcher>()

export function registerFsHandlers(): void {
  const channels = [
    'fs:readFile', 'fs:writeFile', 'fs:readDir',
    'fs:createDir', 'fs:deleteEntry', 'fs:rename', 'fs:exists',
    'fs:openDialog', 'fs:openFile', 'fs:watchDir', 'fs:unwatchDir',
    'fs:searchInFiles', 'fs:replaceInFiles', 'fs:findFiles',
  ]
  for (const ch of channels) ipcMain.removeHandler(ch)

  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    assertInProject(filePath)
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_READ_BYTES) {
        throw new Error(`File too large to read (${(stat.size / 1024 / 1024).toFixed(1)} MB). Limit is 5 MB.`)
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('File too large')) throw err
    }
    return await fs.readFile(filePath, 'utf-8')
  })

  ipcMain.handle('fs:writeFile', async (_, { filePath, content }: { filePath: string; content: string }) => {
    assertInProject(filePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
    return { success: true }
  })

  ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
    assertInProject(dirPath)
    try {
      return await listDir(dirPath)
    } catch {
      return []
    }
  })

  ipcMain.handle('fs:createDir', async (_, dirPath: string) => {
    assertInProject(dirPath)
    await fs.mkdir(dirPath, { recursive: true })
    return { success: true }
  })

  ipcMain.handle('fs:deleteEntry', async (_, entryPath: string) => {
    assertInProject(entryPath)
    await fs.rm(entryPath, { recursive: true, force: true })
    return { success: true }
  })

  ipcMain.handle('fs:rename', async (_, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
    assertInProject(oldPath)
    assertInProject(newPath)
    await fs.rename(oldPath, newPath)
    return { success: true }
  })

  ipcMain.handle('fs:exists', async (_, entryPath: string) => {
    try {
      await fs.access(entryPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:openDialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('fs:openFile', async (event, filters?: Electron.FileFilter[]) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: filters ?? [
        { name: 'Scripts', extensions: ['py', 'ts', 'js', 'sh'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('fs:searchInFiles', async (_, {
    dirPath, query, caseSensitive, regex: useRegex = false,
  }: { dirPath: string; query: string; caseSensitive: boolean; regex?: boolean }) => {
    assertInProject(dirPath)
    if (!query.trim()) return []
    const IGNORE = new Set(['.git', 'node_modules', 'dist', 'out', '__pycache__', '.next', 'build', 'coverage'])
    const IGNORE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.icns', '.lock', '.map', '.woff', '.woff2', '.ttf', '.eot'])
    const results: { file: string; line: number; text: string; matchStart: number; matchEnd: number }[] = []
    const MAX_RESULTS = 200

    let searchRegex: RegExp | null = null
    if (useRegex) {
      try { searchRegex = new RegExp(query, caseSensitive ? 'g' : 'gi') }
      catch { return [] }
    }

    async function walk(dir: string) {
      if (results.length >= MAX_RESULTS) return
      let entries: Dirent[]
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (IGNORE.has(entry.name)) continue
          await walk(fullPath)
        } else {
          const ext = path.extname(entry.name)
          if (IGNORE_EXTS.has(ext)) continue
          try {
            const content = await fs.readFile(fullPath, 'utf-8')
            const lines = content.split('\n')
            for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
              const lineText = lines[i]
              if (searchRegex) {
                searchRegex.lastIndex = 0
                let m: RegExpExecArray | null
                while ((m = searchRegex.exec(lineText)) !== null && results.length < MAX_RESULTS) {
                  results.push({ file: fullPath, line: i + 1, text: lineText.slice(0, 200), matchStart: m.index, matchEnd: m.index + m[0].length })
                  if (m[0].length === 0) searchRegex.lastIndex++
                }
              } else {
                const searchQuery = caseSensitive ? query : query.toLowerCase()
                const searchText = caseSensitive ? lineText : lineText.toLowerCase()
                const idx = searchText.indexOf(searchQuery)
                if (idx !== -1) {
                  results.push({ file: fullPath, line: i + 1, text: lineText.slice(0, 200), matchStart: idx, matchEnd: idx + query.length })
                }
              }
            }
          } catch { /* binary or unreadable */ }
        }
      }
    }

    await walk(dirPath)
    return results
  })

  ipcMain.handle('fs:replaceInFiles', async (_, {
    dirPath, query, replacement, caseSensitive, regex: useRegex = false,
  }: { dirPath: string; query: string; replacement: string; caseSensitive: boolean; regex?: boolean }) => {
    assertInProject(dirPath)
    let filesChanged = 0
    let replacements = 0
    const flags = caseSensitive ? 'g' : 'gi'
    let regex: RegExp
    try {
      const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      regex = new RegExp(pattern, flags)
    }
    catch { return { filesChanged: 0, replacements: 0 } }

    async function walk(dir: string) {
      let entries: Dirent[]
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { await walk(full) }
        else {
          try {
            const content = await fs.readFile(full, 'utf8')
            const matches = content.match(regex)
            if (matches) {
              await fs.writeFile(full, content.replace(regex, replacement), 'utf8')
              filesChanged++
              replacements += matches.length
            }
          } catch { /* binary */ }
        }
      }
    }

    await walk(dirPath)
    return { filesChanged, replacements }
  })

  ipcMain.handle('fs:watchDir', (event, dirPath: string) => {
    if (watchers.has(dirPath)) return

    const sender = event.sender
    const senderIsAlive = (): boolean => {
      try { return !sender.isDestroyed() } catch { return false }
    }

    try {
      const watcher = fsSync.watch(dirPath, { recursive: true }, (eventType, filename) => {
        try {
          if (!senderIsAlive()) {
            watcher.close()
            watchers.delete(dirPath)
            return
          }
          const win = BrowserWindow.fromWebContents(sender)
          if (win && !win.isDestroyed()) {
            sender.send('fs:change', { eventType, filename, dirPath })
          }
        } catch {
          try { watcher.close() } catch { /* ignore */ }
          watchers.delete(dirPath)
        }
      })
      watchers.set(dirPath, watcher)
    } catch {
      // fs.watch not supported on this platform
    }
  })

  ipcMain.handle('fs:unwatchDir', (_, dirPath: string) => {
    watchers.get(dirPath)?.close()
    watchers.delete(dirPath)
  })

  ipcMain.handle('fs:findFiles', async (_, root: string): Promise<string[]> => {
    assertInProject(root)
    const rules = loadIgnoreRules(root)
    const results: string[] = []
    async function walk(dir: string) {
      let entries: Dirent[]
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue
        const full = path.join(dir, e.name)
        if (isIgnored(path.relative(root, full), rules)) continue
        if (e.isDirectory()) await walk(full)
        else results.push(path.relative(root, full))
        if (results.length >= 5000) return
      }
    }
    await walk(root)
    return results
  })
}
