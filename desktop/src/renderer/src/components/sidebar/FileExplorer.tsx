import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderPlus } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { fg, surface, accent, border } from '../../design'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
  expanded?: boolean
}

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'tsx'].includes(ext)) return accent.blue.fg
  if (['js', 'jsx', 'mjs'].includes(ext)) return accent.amber.fg
  if (['py'].includes(ext)) return accent.cyan.fg
  if (['json', 'jsonc'].includes(ext)) return accent.green.fg
  if (['md', 'mdx'].includes(ext)) return accent.violet.fg
  if (['css', 'scss', 'less'].includes(ext)) return 'hsl(330 60% 60%)'
  if (['sh', 'bash', 'zsh'].includes(ext)) return accent.amber.bright
  return fg[1]
}

function FileNode({
  entry,
  depth,
  onOpen,
  onToggle,
}: {
  entry: FileEntry
  depth: number
  onOpen: (e: FileEntry) => void
  onToggle: (path: string) => void
}) {
  return (
    <>
      <div
        onClick={() => (entry.isDirectory ? onToggle(entry.path) : onOpen(entry))}
        title={entry.path}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: `2px 8px 2px ${8 + depth * 12}px`,
          cursor: 'pointer',
          fontSize: 12,
          color: entry.isDirectory ? fg[1] : getFileColor(entry.name),
          userSelect: 'none',
        }}
      >
        {entry.isDirectory ? (
          <>
            {entry.expanded ? <ChevronDown size={12} style={{ flexShrink: 0 }} /> : <ChevronRight size={12} style={{ flexShrink: 0 }} />}
            {entry.expanded ? (
              <FolderOpen size={13} style={{ color: accent.amber.fg, flexShrink: 0 }} />
            ) : (
              <Folder size={13} style={{ color: accent.amber.fg, flexShrink: 0 }} />
            )}
          </>
        ) : (
          <>
            <span style={{ width: 12, flexShrink: 0 }} />
            <File size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
          </>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name}
        </span>
      </div>
      {entry.isDirectory && entry.expanded && entry.children?.map((child) => (
        <FileNode key={child.path} entry={child} depth={depth + 1} onOpen={onOpen} onToggle={onToggle} />
      ))}
    </>
  )
}

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export function FileExplorer() {
  const [tree, setTree] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const saveSettings = useSettingsStore((s) => s.save)
  const openFile = useEditorStore((s) => s.openFile)

  const loadDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    try {
      const entries = await window.api.fs.readDir(dirPath) as DirEntry[]
      if (!Array.isArray(entries)) return []
      const sorted = [...entries].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      return sorted
        .filter((e) => !e.name.startsWith('.') || e.name === '.env')
        .filter((e) => !['node_modules', '__pycache__', 'dist', '.git', '.next', 'build'].includes(e.name))
        .map((e) => ({
          name: e.name,
          path: e.path,
          isDirectory: e.isDirectory,
          children: e.isDirectory ? [] : undefined,
          expanded: false,
        }))
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    if (!projectPath) return
    setLoading(true)
    loadDir(projectPath).then((entries) => {
      setTree(entries)
      setLoading(false)
    })
  }, [projectPath, loadDir])

  // Watch for changes
  useEffect(() => {
    if (!projectPath) return
    window.api.fs.watchDir(projectPath)
    const unwatch = window.api.fs.onFileChange(() => {
      loadDir(projectPath).then(setTree)
    })
    return () => {
      window.api.fs.unwatchDir(projectPath)
      unwatch()
    }
  }, [projectPath, loadDir])

  const handleOpen = async (entry: FileEntry) => {
    try {
      const content = await window.api.fs.readFile(entry.path)
      openFile(entry.path, content)
    } catch (err) {
      toast.error(`Cannot open file: ${(err as Error).message}`)
    }
  }

  const handleToggle = async (path: string) => {
    const toggle = async (entries: FileEntry[]): Promise<FileEntry[]> => {
      return Promise.all(
        entries.map(async (e) => {
          if (e.path === path) {
            const expanded = !e.expanded
            const children = expanded && e.children?.length === 0 ? await loadDir(path) : e.children
            return { ...e, expanded, children }
          }
          if (e.children) {
            return { ...e, children: await toggle(e.children) }
          }
          return e
        })
      )
    }
    setTree(await toggle(tree))
  }

  const openFolder = async () => {
    const dir = await window.api.fs.openDialog()
    if (!dir) return
    await saveSettings({
      projectPath: dir,
      recentProjects: [dir, ...useSettingsStore.getState().recentProjects.filter((p) => p !== dir)].slice(0, 10),
    })
  }

  if (!projectPath) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          gap: 12,
        }}
      >
        <FolderOpen size={32} style={{ color: fg[3] }} />
        <p style={{ fontSize: 12, color: fg[2], textAlign: 'center' }}>No folder open</p>
        <button
          onClick={openFolder}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12,
            color: fg[1],
          }}
        >
          <FolderPlus size={13} />
          Open Folder
        </button>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingTop: 4 }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 8px 4px',
        }}
      >
        <button
          onClick={openFolder}
          title="Open different folder"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], padding: 2 }}
        >
          <FolderPlus size={13} />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 16, fontSize: 12, color: fg[3] }}>Loading…</div>
      ) : tree.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: fg[3] }}>Empty folder</div>
      ) : (
        tree.map((entry) => (
          <FileNode key={entry.path} entry={entry} depth={0} onOpen={handleOpen} onToggle={handleToggle} />
        ))
      )}
    </div>
  )
}
