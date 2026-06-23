import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderPlus, FilePlus, Pencil, Trash2, Copy } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { fg, surface, accent, border } from '../../design'
import { isImageFile } from '../../utils/fileType'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
  expanded?: boolean
}

// Pending inline creation/rename state
interface InlineEdit {
  type: 'new-file' | 'new-folder' | 'rename'
  parentPath: string   // directory to create in (or file's parent for rename)
  originalName?: string
  originalPath?: string
}

interface ContextMenu {
  x: number
  y: number
  entry: FileEntry
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

// Tiny floating context menu rendered as a portal-style absolute div
function CtxMenu({
  menu,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
}: {
  menu: ContextMenu
  onClose: () => void
  onNewFile: (entry: FileEntry) => void
  onNewFolder: (entry: FileEntry) => void
  onRename: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
  onCopyPath: (entry: FileEntry) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const item = (label: string, icon: React.ReactNode, action: () => void, danger = false) => (
    <button
      type="button"
      onMouseDown={(e) => { e.stopPropagation(); action(); onClose() }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '6px 12px',
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 12, color: danger ? accent.red.fg : fg[1], textAlign: 'left',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = surface.raised }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      {icon}
      {label}
    </button>
  )

  const divider = () => <div style={{ height: 1, background: border[1], margin: '3px 0' }} />

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: menu.y,
        left: menu.x,
        zIndex: 1000,
        background: surface.overlay,
        border: `1px solid ${border[0]}`,
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        minWidth: 180,
        padding: '3px 0',
        overflow: 'hidden',
      }}
    >
      {menu.entry.isDirectory && (
        <>
          {item('New File', <FilePlus size={12} />, () => onNewFile(menu.entry))}
          {item('New Folder', <FolderPlus size={12} />, () => onNewFolder(menu.entry))}
          {divider()}
        </>
      )}
      {item('Rename', <Pencil size={12} />, () => onRename(menu.entry))}
      {item('Copy Path', <Copy size={12} />, () => onCopyPath(menu.entry))}
      {divider()}
      {item('Delete', <Trash2 size={12} />, () => onDelete(menu.entry), true)}
    </div>
  )
}

// Inline input for new file/folder name or rename
function InlineInput({
  defaultValue,
  placeholder,
  onCommit,
  onCancel,
  depth,
}: {
  defaultValue: string
  placeholder: string
  onCommit: (name: string) => void
  onCancel: () => void
  depth: number
}) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: `2px 8px 2px ${8 + depth * 12}px` }}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        title={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) { e.preventDefault(); onCommit(value.trim()) }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={() => { if (value.trim()) onCommit(value.trim()); else onCancel() }}
        style={{
          flex: 1, fontSize: 12, background: surface.raised,
          border: `1px solid ${accent.violet.border}`, borderRadius: 3,
          color: fg[0], padding: '2px 6px', outline: 'none',
        }}
      />
    </div>
  )
}

function ActionBtn({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
  children: React.ReactNode
}) {
  const [h, setH] = useState(false)
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', display: 'flex',
        alignItems: 'center', padding: '1px 3px', borderRadius: 3,
        color: h ? (danger ? accent.red.fg : fg[0]) : fg[3],
      }}
    >
      {children}
    </button>
  )
}

function FileNode({
  entry,
  depth,
  onOpen,
  onToggle,
  onContextMenu,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  inlineEdit,
  onInlineCommit,
  onInlineCancel,
}: {
  entry: FileEntry
  depth: number
  onOpen: (e: FileEntry) => void
  onToggle: (path: string) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
  onNewFile: (entry: FileEntry) => void
  onNewFolder: (entry: FileEntry) => void
  onRename: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
  inlineEdit: InlineEdit | null
  onInlineCommit: (name: string) => void
  onInlineCancel: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const isRenaming = inlineEdit?.type === 'rename' && inlineEdit.originalPath === entry.path
  const showNewChildInput = entry.isDirectory && entry.expanded &&
    (inlineEdit?.type === 'new-file' || inlineEdit?.type === 'new-folder') &&
    inlineEdit.parentPath === entry.path

  return (
    <>
      {isRenaming ? (
        <InlineInput
          defaultValue={entry.name}
          placeholder="New name"
          onCommit={onInlineCommit}
          onCancel={onInlineCancel}
          depth={depth}
        />
      ) : (
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => (entry.isDirectory ? onToggle(entry.path) : onOpen(entry))}
          onContextMenu={(e) => onContextMenu(e, entry)}
          title={entry.path}
          style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', gap: 4,
            padding: `2px 8px 2px ${8 + depth * 12}px`,
            cursor: 'pointer', fontSize: 12,
            color: entry.isDirectory ? fg[1] : getFileColor(entry.name),
            userSelect: 'none',
            background: hovered ? surface.overlay : 'transparent',
          }}
        >
          {entry.isDirectory ? (
            <>
              {entry.expanded ? <ChevronDown size={12} style={{ flexShrink: 0 }} /> : <ChevronRight size={12} style={{ flexShrink: 0 }} />}
              {entry.expanded
                ? <FolderOpen size={13} style={{ color: accent.amber.fg, flexShrink: 0 }} />
                : <Folder size={13} style={{ color: accent.amber.fg, flexShrink: 0 }} />}
            </>
          ) : (
            <>
              <span style={{ width: 12, flexShrink: 0 }} />
              <File size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            </>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {entry.name}
          </span>

          {hovered && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              {entry.isDirectory && (
                <>
                  <ActionBtn title="New File" onClick={(e) => { e.stopPropagation(); onNewFile(entry) }}>
                    <FilePlus size={11} />
                  </ActionBtn>
                  <ActionBtn title="New Folder" onClick={(e) => { e.stopPropagation(); onNewFolder(entry) }}>
                    <FolderPlus size={11} />
                  </ActionBtn>
                </>
              )}
              <ActionBtn title="Rename (F2)" onClick={(e) => { e.stopPropagation(); onRename(entry) }}>
                <Pencil size={11} />
              </ActionBtn>
              <ActionBtn title="Delete" danger onClick={(e) => { e.stopPropagation(); onDelete(entry) }}>
                <Trash2 size={11} />
              </ActionBtn>
            </div>
          )}
        </div>
      )}

      {entry.isDirectory && entry.expanded && (
        <>
          {showNewChildInput && (
            <InlineInput
              defaultValue=""
              placeholder={inlineEdit?.type === 'new-folder' ? 'folder name' : 'file name'}
              onCommit={onInlineCommit}
              onCancel={onInlineCancel}
              depth={depth + 1}
            />
          )}
          {entry.children?.map((child) => (
            <FileNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onOpen={onOpen}
              onToggle={onToggle}
              onContextMenu={onContextMenu}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onRename={onRename}
              onDelete={onDelete}
              inlineEdit={inlineEdit}
              onInlineCommit={onInlineCommit}
              onInlineCancel={onInlineCancel}
            />
          ))}
        </>
      )}
    </>
  )
}

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

const IGNORED = new Set(['node_modules', '__pycache__', 'dist', '.git', '.next', 'build', '.venv', '.tox'])

export function FileExplorer() {
  const [tree, setTree] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null)

  const projectPath = useSettingsStore((s) => s.projectPath)
  const saveSettings = useSettingsStore((s) => s.save)
  const openFile = useEditorStore((s) => s.openFile)

  const loadDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    try {
      const entries = await window.api.fs.readDir(dirPath) as DirEntry[]
      if (!Array.isArray(entries)) return []
      return [...entries]
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .filter((e) => !IGNORED.has(e.name))
        .filter((e) => !e.name.startsWith('.') || e.name === '.env')
        .map((e) => ({ name: e.name, path: e.path, isDirectory: e.isDirectory, children: e.isDirectory ? [] : undefined, expanded: false }))
    } catch { return [] }
  }, [])

  useEffect(() => {
    if (!projectPath) return
    setLoading(true)
    loadDir(projectPath).then((entries) => { setTree(entries); setLoading(false) })
  }, [projectPath, loadDir])

  useEffect(() => {
    if (!projectPath) return
    window.api.fs.watchDir(projectPath)
    const unwatch = window.api.fs.onFileChange(() => { loadDir(projectPath).then(setTree) })
    return () => { window.api.fs.unwatchDir(projectPath); unwatch() }
  }, [projectPath, loadDir])

  const handleOpen = async (entry: FileEntry) => {
    try {
      const content = isImageFile(entry.path) ? '' : await window.api.fs.readFile(entry.path)
      openFile(entry.path, content)
    } catch (err) { toast.error(`Cannot open: ${(err as Error).message}`) }
  }

  const handleToggle = async (path: string) => {
    const toggle = async (entries: FileEntry[]): Promise<FileEntry[]> =>
      Promise.all(entries.map(async (e) => {
        if (e.path === path) {
          const expanded = !e.expanded
          const children = expanded && e.children?.length === 0 ? await loadDir(path) : e.children
          return { ...e, expanded, children }
        }
        return e.children ? { ...e, children: await toggle(e.children) } : e
      }))
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

  // ── Context menu actions ─────────────────────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, entry })
    setInlineEdit(null)
  }

  const handleNewFile = async (entry: FileEntry) => {
    // Ensure the directory is expanded so the inline input is visible
    if (!entry.expanded) await handleToggle(entry.path)
    setInlineEdit({ type: 'new-file', parentPath: entry.path })
  }

  const handleNewFolder = async (entry: FileEntry) => {
    if (!entry.expanded) await handleToggle(entry.path)
    setInlineEdit({ type: 'new-folder', parentPath: entry.path })
  }

  const handleRename = (entry: FileEntry) => {
    const parent = entry.path.slice(0, entry.path.lastIndexOf('/'))
    setInlineEdit({ type: 'rename', parentPath: parent, originalName: entry.name, originalPath: entry.path })
  }

  const handleDelete = async (entry: FileEntry) => {
    const label = entry.isDirectory ? 'folder' : 'file'
    if (!window.confirm(`Delete ${label} "${entry.name}"? This cannot be undone.`)) return
    try {
      await window.api.fs.deleteEntry(entry.path)
      toast.success(`Deleted ${entry.name}`)
    } catch (err) { toast.error(`Delete failed: ${(err as Error).message}`) }
  }

  const handleCopyPath = (entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(() => {})
    toast.success('Path copied')
  }

  const handleInlineCommit = async (name: string) => {
    if (!inlineEdit) return
    const { type, parentPath, originalPath } = inlineEdit
    setInlineEdit(null)

    if (type === 'rename' && originalPath) {
      const newPath = `${parentPath}/${name}`
      try {
        await window.api.fs.rename(originalPath, newPath)
        toast.success(`Renamed to ${name}`)
      } catch (err) { toast.error(`Rename failed: ${(err as Error).message}`) }
      return
    }

    const newPath = `${parentPath}/${name}`
    try {
      if (type === 'new-folder') {
        await window.api.fs.createDir(newPath)
      } else {
        await window.api.fs.writeFile(newPath, '')
        const content = await window.api.fs.readFile(newPath)
        openFile(newPath, content)
      }
      toast.success(`Created ${name}`)
    } catch (err) { toast.error(`Create failed: ${(err as Error).message}`) }
  }

  if (!projectPath) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 }}>
        <FolderOpen size={32} style={{ color: fg[3] }} />
        <p style={{ fontSize: 12, color: fg[2], textAlign: 'center' }}>No folder open</p>
        <button
          onClick={openFolder}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: surface.raised, border: `1px solid ${border[0]}`,
            borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: fg[1],
          }}
        >
          <FolderPlus size={13} /> Open Folder
        </button>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px 4px' }}>
        <button onClick={openFolder} title="Open different folder"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], padding: 2 }}>
          <FolderPlus size={13} />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 16, fontSize: 12, color: fg[3] }}>Loading…</div>
      ) : tree.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: fg[3] }}>Empty folder</div>
      ) : (
        tree.map((entry) => (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={0}
            onOpen={handleOpen}
            onToggle={handleToggle}
            onContextMenu={handleContextMenu}
            onNewFile={handleNewFile}
            onNewFolder={handleNewFolder}
            onRename={handleRename}
            onDelete={handleDelete}
            inlineEdit={inlineEdit}
            onInlineCommit={handleInlineCommit}
            onInlineCancel={() => setInlineEdit(null)}
          />
        ))
      )}

      {ctxMenu && (
        <CtxMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
          onCopyPath={handleCopyPath}
        />
      )}
    </div>
  )
}
