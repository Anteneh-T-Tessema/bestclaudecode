import { useState, useEffect, useRef, useCallback } from 'react'
import { Folder, FileText, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useEditorActionsStore } from '../../store/useEditorActionsStore'
import { accent, border, fg, surface } from '../../design'
import { isMarkdownFile } from '../../utils/fileType'

interface DirEntry { name: string; path: string; isDirectory: boolean }
interface PickerState { dirPath: string; rect: DOMRect }

const IGNORE = new Set(['node_modules', '.git', 'dist', 'out', '__pycache__', '.next', 'build'])

function SegmentPicker({
  dirPath,
  rect,
  onClose,
}: {
  dirPath: string
  rect: DOMRect
  onClose: () => void
}) {
  const openFile = useEditorStore((s) => s.openFile)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [currentDir, setCurrentDir] = useState(dirPath)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    window.api.fs.readDir(currentDir)
      .then((raw) => {
        const es = (raw as DirEntry[]).filter((e) => !IGNORE.has(e.name))
        es.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setEntries(es)
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [currentDir])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const handleEntry = useCallback(async (entry: DirEntry) => {
    if (entry.isDirectory) {
      setCurrentDir(entry.path)
    } else {
      try {
        const content = await window.api.fs.readFile(entry.path)
        openFile(entry.path, content)
      } catch { /* ignore */ }
      onClose()
    }
  }, [openFile, onClose])

  const top = Math.min(rect.bottom + 2, window.innerHeight - 300)
  const left = Math.min(rect.left, window.innerWidth - 240)

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 8500,
        width: 240,
        maxHeight: 280,
        background: surface.overlay,
        border: `1px solid ${border[0]}`,
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        overflowY: 'auto',
      }}
    >
      {loading && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: fg[3] }}>Loading…</div>
      )}
      {!loading && entries.length === 0 && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: fg[3] }}>Empty folder</div>
      )}
      {entries.map((e) => (
        <div
          key={e.path}
          onClick={() => void handleEntry(e)}
          onMouseEnter={() => setHovered(e.path)}
          onMouseLeave={() => setHovered(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 10px',
            cursor: 'pointer',
            background: hovered === e.path ? surface.raised : 'transparent',
          }}
        >
          {e.isDirectory
            ? <Folder style={{ width: 12, height: 12, color: accent.amber.fg, flexShrink: 0 }} />
            : <FileText style={{ width: 12, height: 12, color: fg[3], flexShrink: 0 }} />}
          <span style={{
            fontSize: 12,
            color: e.isDirectory ? fg[1] : fg[2],
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {e.name}
          </span>
          {e.isDirectory && (
            <ChevronRight style={{ width: 10, height: 10, color: fg[4], flexShrink: 0, marginLeft: 'auto' }} />
          )}
        </div>
      ))}
    </div>
  )
}

export function Breadcrumb() {
  const activeTab = useEditorStore((s) => s.getActiveTab())
  const projectPath = useSettingsStore((s) => s.projectPath)
  const mdPreviewOpen = useEditorActionsStore((s) => s.mdPreviewOpen)
  const toggleMdPreview = useEditorActionsStore((s) => s.toggleMdPreview)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const isMd = isMarkdownFile(activeTab?.filePath ?? '')

  if (!activeTab?.filePath || !projectPath) return null

  const rel = activeTab.filePath.startsWith(projectPath)
    ? activeTab.filePath.slice(projectPath.length).replace(/^\//, '')
    : activeTab.filePath
  const parts = rel.split('/').filter(Boolean)
  if (parts.length === 0) return null

  const handleSegmentClick = (e: React.MouseEvent<HTMLSpanElement>, segIdx: number) => {
    const segmentPath = projectPath + '/' + parts.slice(0, segIdx + 1).join('/')
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPicker((prev) =>
      prev?.dirPath === segmentPath ? null : { dirPath: segmentPath, rect }
    )
  }

  return (
    <div
      style={{
        height: 22,
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: 2,
        background: surface.raised,
        borderBottom: `1px solid ${border[1]}`,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1
        const segmentPath = projectPath + '/' + parts.slice(0, i + 1).join('/')
        const isActive = picker?.dirPath === segmentPath
        return (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            {!isLast ? (
              <span
                onClick={(e) => handleSegmentClick(e, i)}
                style={{
                  fontSize: 11,
                  color: isActive ? accent.amber.fg : fg[3],
                  cursor: 'pointer',
                  padding: '1px 3px',
                  borderRadius: 3,
                  background: isActive ? accent.amber.subtle : 'transparent',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                {part}
              </span>
            ) : (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: fg[0],
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {part}
              </span>
            )}
            {!isLast && (
              <ChevronRight style={{ width: 10, height: 10, color: fg[4], flexShrink: 0 }} />
            )}
          </span>
        )
      })}

      {picker && (
        <SegmentPicker
          dirPath={picker.dirPath}
          rect={picker.rect}
          onClose={() => setPicker(null)}
        />
      )}

      {isMd && (
        <>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={toggleMdPreview}
            title={mdPreviewOpen ? 'Close preview' : 'Open Markdown preview'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '1px 6px',
              borderRadius: 3,
              fontSize: 11,
              color: mdPreviewOpen ? accent.cyan.fg : fg[3],
              flexShrink: 0,
            }}
          >
            {mdPreviewOpen ? <EyeOff size={11} /> : <Eye size={11} />}
            Preview
          </button>
        </>
      )}
    </div>
  )
}
