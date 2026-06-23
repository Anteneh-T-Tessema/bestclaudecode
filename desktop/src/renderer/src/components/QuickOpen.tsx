import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, FileText, Clock } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useEditorStore } from '../store/useEditorStore'
import { accent, border, fg, surface } from '../design'
import { isImageFile } from '../utils/fileType'

interface FileEntry {
  path: string
  name: string
  relativePath: string
}

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '__pycache__', '.next', 'build', 'coverage'])
const IGNORE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.icns', '.lock', '.map'])
const MAX_RESULTS = 50
const MAX_FILES = 3000

async function walkProject(root: string): Promise<FileEntry[]> {
  const results: FileEntry[] = []

  async function walk(dir: string) {
    if (results.length >= MAX_FILES) return
    let entries: DirEntry[]
    try {
      entries = (await window.api.fs.readDir(dir)) as DirEntry[]
    } catch {
      return
    }
    if (!Array.isArray(entries)) return
    for (const e of entries) {
      if (results.length >= MAX_FILES) return
      if (e.isDirectory) {
        if (IGNORE_DIRS.has(e.name)) continue
        await walk(e.path)
      } else {
        const ext = e.name.includes('.') ? '.' + e.name.split('.').pop()! : ''
        if (IGNORE_EXTS.has(ext)) continue
        const rel = e.path.startsWith(root) ? e.path.slice(root.length).replace(/^\//, '') : e.path
        results.push({ path: e.path, name: e.name, relativePath: rel })
      }
    }
  }

  await walk(root)
  return results
}

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx === 0) return 100
  if (idx > 0) return 80
  let score = 50
  let qi = 0
  let lastMatch = -1
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (lastMatch === i - 1) score += 2
      lastMatch = i
      qi++
    }
  }
  return score
}

function highlightMatch(query: string, text: string): React.ReactNode {
  if (!query) return text
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const chars: React.ReactNode[] = []
  let qi = 0
  for (let i = 0; i < text.length; i++) {
    if (qi < q.length && t[i] === q[qi]) {
      chars.push(
        <span key={i} style={{ color: accent.amber.bright, fontWeight: 600 }}>
          {text[i]}
        </span>
      )
      qi++
    } else {
      chars.push(text[i])
    }
  }
  return chars
}

function extColor(ext: string): string {
  switch (ext) {
    case 'ts':
    case 'tsx':
      return accent.cyan.fg
    case 'js':
    case 'jsx':
      return accent.amber.fg
    case 'md':
      return accent.green.fg
    case 'yaml':
    case 'yml':
      return accent.violet.fg
    case 'json':
      return accent.amber.fg
    case 'py':
      return accent.amber.fg
    default:
      return fg[3]
  }
}

export function QuickOpen() {
  const open = useAppStore((s) => s.quickOpenOpen)
  const setOpen = useAppStore((s) => s.setQuickOpenOpen)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const openFile = useEditorStore((s) => s.openFile)

  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!projectPath || !open) return
    setLoading(true)
    walkProject(projectPath)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false))
  }, [projectPath, open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`) as HTMLElement | null
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const filtered = files
    .filter((f) => fuzzyMatch(query, f.name) || fuzzyMatch(query, f.relativePath))
    .sort((a, b) => {
      const sa = Math.max(fuzzyScore(query, a.name), fuzzyScore(query, a.relativePath) * 0.7)
      const sb = Math.max(fuzzyScore(query, b.name), fuzzyScore(query, b.relativePath) * 0.7)
      return sb - sa
    })
    .slice(0, MAX_RESULTS)

  const handleOpen = useCallback(
    async (file: FileEntry) => {
      try {
        const content = isImageFile(file.path) ? '' : await window.api.fs.readFile(file.path)
        openFile(file.path, content)
      } finally {
        setOpen(false)
      }
    },
    [openFile, setOpen]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) handleOpen(filtered[selectedIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '8vh',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{
          width: 600,
          maxWidth: '90vw',
          background: surface.raised,
          border: `1px solid ${border[0]}`,
          borderRadius: 10,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderBottom: `1px solid ${border[1]}`,
          }}
        >
          <Search size={15} color={fg[2]} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to file…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 14,
              color: fg[0],
            }}
          />
          <kbd
            style={{
              fontSize: 10,
              color: fg[3],
              background: border[1],
              border: `1px solid ${border[0]}`,
              borderRadius: 3,
              padding: '2px 5px',
            }}
          >
            ESC
          </kbd>
        </div>

        <div ref={listRef} style={{ maxHeight: 380, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: fg[3], fontSize: 12 }}>
              Scanning files…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: fg[3], fontSize: 12 }}>
              {query ? `No files matching "${query}"` : 'No files found in project'}
            </div>
          )}

          {!loading && !query && filtered.length > 0 && (
            <div
              style={{
                padding: '6px 14px 2px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: fg[4],
              }}
            >
              <Clock size={9} style={{ display: 'inline', marginRight: 4 }} />
              Project Files
            </div>
          )}

          {filtered.map((file, idx) => {
            const isSelected = idx === selectedIndex
            const ext = file.name.split('.').pop() ?? ''
            return (
              <div
                key={file.path}
                data-idx={idx}
                onClick={() => handleOpen(file)}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 14px',
                  cursor: 'pointer',
                  background: isSelected ? surface.overlay : 'transparent',
                  borderLeft: isSelected ? `2px solid ${accent.amber.fg}` : '2px solid transparent',
                }}
              >
                <FileText size={13} color={isSelected ? accent.amber.fg : extColor(ext)} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: isSelected ? fg[0] : fg[1],
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {highlightMatch(query, file.name)}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: fg[3],
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {highlightMatch(query, file.relativePath)}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: fg[4],
                    background: surface.overlay,
                    padding: '1px 5px',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                >
                  {ext || 'file'}
                </span>
              </div>
            )
          })}
        </div>

        <div
          style={{
            padding: '5px 14px',
            borderTop: `1px solid ${border[1]}`,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
          }}
        >
          {[['↑↓', 'navigate'], ['↵', 'open'], ['Esc', 'close']].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <kbd
                style={{
                  fontSize: 9,
                  color: fg[3],
                  background: surface.overlay,
                  border: `1px solid ${border[0]}`,
                  borderRadius: 2,
                  padding: '1px 4px',
                }}
              >
                {key}
              </kbd>
              <span style={{ fontSize: 10, color: fg[4] }}>{label}</span>
            </div>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: fg[4] }}>
            {filtered.length > 0 ? `${filtered.length} file${filtered.length !== 1 ? 's' : ''}` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
