import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, StickyNote } from 'lucide-react'
import { useNotepadStore } from '../../store/useNotepadStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { EmptyState } from '../EmptyState'
import { accent, border, fg, surface } from '../../design'

export function NotepadsPanel() {
  const projectPath = useSettingsStore((s) => s.projectPath)
  const { notepads, activeId, loadForProject, createNotepad, deleteNotepad, updateContent, renameNotepad, setActiveId } =
    useNotepadStore()
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (projectPath) loadForProject(projectPath)
  }, [projectPath, loadForProject])

  useEffect(() => {
    if (editingTitleId) setTimeout(() => titleInputRef.current?.focus(), 30)
  }, [editingTitleId])

  const activeNotepad = notepads.find((n) => n.id === activeId) ?? null

  const startRename = (id: string, currentTitle: string) => {
    setEditingTitleId(id)
    setTitleDraft(currentTitle)
  }

  const commitRename = () => {
    if (editingTitleId) {
      renameNotepad(editingTitleId, titleDraft.trim() || 'Untitled')
      setEditingTitleId(null)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Notepad list */}
      <div style={{ flex: '0 0 auto', maxHeight: '40%', overflowY: 'auto', borderBottom: `1px solid ${border[1]}` }}>
        {/* New notepad button */}
        <button
          type="button"
          onClick={createNotepad}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '7px 10px',
            background: 'none',
            border: 'none',
            borderBottom: `1px solid ${border[2]}`,
            color: accent.amber.fg,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = surface.overlay }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
        >
          <Plus size={12} />
          New notepad
        </button>

        {notepads.length === 0 && (
          <div style={{ padding: '10px 12px', fontSize: 11, color: fg[3] }}>
            No notepads yet.
          </div>
        )}

        {notepads.map((np) => {
          const isActive = np.id === activeId
          return (
            <div
              key={np.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px 5px 10px',
                background: isActive ? surface.overlay : 'none',
                borderBottom: `1px solid ${border[2]}`,
                borderLeft: isActive ? `2px solid ${accent.amber.fg}` : '2px solid transparent',
                cursor: 'pointer',
              }}
              onClick={() => setActiveId(np.id)}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = surface.raised
                const del = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.np-del')
                if (del) del.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'none'
                const del = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.np-del')
                if (del) del.style.opacity = '0'
              }}
            >
              <StickyNote size={12} style={{ color: accent.amber.fg, flexShrink: 0 }} />
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: isActive ? fg[0] : fg[1],
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: isActive ? 600 : 400,
                  userSelect: 'none',
                }}
                onDoubleClick={(e) => { e.stopPropagation(); startRename(np.id, np.title) }}
              >
                {np.title}
              </span>
              <button
                type="button"
                className="np-del"
                onClick={(e) => { e.stopPropagation(); deleteNotepad(np.id) }}
                style={{
                  opacity: 0,
                  background: 'none',
                  border: 'none',
                  color: fg[3],
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  transition: 'opacity 0.1s',
                }}
                title="Delete notepad"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Editor area */}
      {activeNotepad ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {/* Title row */}
          <div style={{
            padding: '6px 10px',
            borderBottom: `1px solid ${border[2]}`,
            flexShrink: 0,
          }}>
            {editingTitleId === activeNotepad.id ? (
              <input
                ref={titleInputRef}
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') commitRename()
                }}
                style={{
                  width: '100%',
                  background: surface.raised,
                  border: `1px solid ${accent.amber.fg}`,
                  borderRadius: 4,
                  color: fg[0],
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '2px 6px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            ) : (
              <span
                style={{ fontSize: 12, fontWeight: 600, color: fg[0], cursor: 'text', userSelect: 'none' }}
                onDoubleClick={() => startRename(activeNotepad.id, activeNotepad.title)}
                title="Double-click to rename"
              >
                {activeNotepad.title}
              </span>
            )}
          </div>

          {/* Content textarea */}
          <textarea
            value={activeNotepad.content}
            onChange={(e) => updateContent(activeNotepad.id, e.target.value)}
            placeholder="Write anything…"
            style={{
              flex: 1,
              resize: 'none',
              background: surface.surface,
              border: 'none',
              color: fg[0],
              fontSize: 12,
              fontFamily: 'inherit',
              lineHeight: 1.6,
              padding: '10px 12px',
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          <EmptyState
            icon={<StickyNote size={20} />}
            title="No notepads"
            description="Create a notepad to start writing."
          />
        </div>
      )}
    </div>
  )
}
