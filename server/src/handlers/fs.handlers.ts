import type { HandlerRegistry } from '../router.js'
import type { DirEntry } from '../sandbox/types.js'

const IGNORE_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store', '.idea'])

// Mirrors the sort/filter behavior of desktop/src/main/ipc/fs.handlers.ts's
// listDir() — directories first, then alphabetical — so the renderer's file
// tree component needs no changes when it switches to this transport.
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries
    .filter((e) => !IGNORE_DIRS.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function registerFsHandlers(registry: HandlerRegistry): void {
  registry.register('fs:readFile', async (adapter, payload) => {
    const { path: filePath } = payload as { path: string }
    return adapter.readFile(filePath)
  })

  registry.register('fs:writeFile', async (adapter, payload) => {
    const { path: filePath, content } = payload as { path: string; content: string }
    await adapter.writeFile(filePath, content)
    return { success: true }
  })

  registry.register('fs:readDir', async (adapter, payload) => {
    const { path: dirPath } = payload as { path: string }
    try {
      return sortEntries(await adapter.readDir(dirPath))
    } catch {
      return []
    }
  })

  registry.register('fs:createDir', async (adapter, payload) => {
    const { path: dirPath } = payload as { path: string }
    await adapter.makeDir(dirPath)
    return { success: true }
  })

  registry.register('fs:deleteEntry', async (adapter, payload) => {
    const { path: entryPath } = payload as { path: string }
    await adapter.deleteEntry(entryPath)
    return { success: true }
  })

  registry.register('fs:rename', async (adapter, payload) => {
    const { oldPath, newPath } = payload as { oldPath: string; newPath: string }
    await adapter.rename(oldPath, newPath)
    return { success: true }
  })

  registry.register('fs:exists', async (adapter, payload) => {
    const { path: entryPath } = payload as { path: string }
    return adapter.exists(entryPath)
  })
}
