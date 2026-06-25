import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FolderOpen, Search, GitCommit, MessageSquare, ShieldCheck, Settings,
  PanelBottom, PanelLeft, Trash2, Keyboard, FolderInput, FileText, Hash, Clock, RefreshCw,
} from 'lucide-react'
import { useAppStore, type ActivityId } from '../store/useAppStore'
import { useEditorStore } from '../store/useEditorStore'
import { useEditorActionsStore } from '../store/useEditorActionsStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { accent, border, fg, surface } from '../design'

interface Command {
  id: string
  label: string
  description?: string
  shortcut?: string
  category: string
  icon?: React.ReactNode
  action: () => void
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
  return 50
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setActiveActivity = useAppStore((s) => s.setActiveActivity)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleBottomPanel = useAppStore((s) => s.toggleBottomPanel)
  const setQuickOpenOpen = useAppStore((s) => s.setQuickOpenOpen)
  const setSymbolSearchOpen = useAppStore((s) => s.setSymbolSearchOpen)
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen)
  const saveSettings = useSettingsStore((s) => s.save)
  const recentFiles = useSettingsStore((s) => s.recentFiles)
  const openGoToLine = useEditorActionsStore((s) => s.openGoToLine)
  const tabs = useEditorStore((s) => s.tabs)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const openFile = useEditorStore((s) => s.openFile)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [setOpen])

  const goTo = useCallback(
    (id: ActivityId) => {
      setActiveActivity(id)
      close()
    },
    [setActiveActivity, close]
  )

  const closeAllTabs = useCallback(() => {
    const { tabs, closeTab } = useEditorStore.getState()
    tabs.forEach((t) => closeTab(t.id))
  }, [])

  const openFolder = useCallback(async () => {
    const dir = await window.api.fs.openDialog()
    if (!dir) return
    await saveSettings({
      projectPath: dir,
      recentProjects: [dir, ...useSettingsStore.getState().recentProjects.filter((p) => p !== dir)].slice(0, 10),
    })
  }, [saveSettings])

  const openTabPaths = new Set(tabs.map((t) => t.filePath))

  const recentCommands: Command[] = recentFiles
    .filter((fp) => !openTabPaths.has(fp))
    .slice(0, 8)
    .map((fp) => ({
      id: `recent-${fp}`,
      category: 'Recent Files',
      label: fp.split('/').pop() ?? fp,
      description: fp,
      icon: <Clock size={13} />,
      action: () => {
        void window.api.fs.readFile(fp)
          .then((content) => { openFile(fp, content); close() })
          .catch(() => close())
      },
    }))

  const tabCommands: Command[] = tabs.map((t) => ({
    id: `tab-${t.id}`,
    category: 'Open Tabs',
    label: t.filePath?.split('/').pop() ?? t.id,
    icon: <FileText size={13} />,
    action: () => {
      setActiveTab(t.id)
      close()
    },
  }))

  const commands: Command[] = [
    ...recentCommands,
    ...tabCommands,

    { id: 'go-files', category: 'Go to', label: 'Explorer', icon: <FolderOpen size={13} />, action: () => goTo('files') },
    { id: 'go-git', category: 'Go to', label: 'Source Control', icon: <GitCommit size={13} />, action: () => goTo('git') },
    { id: 'go-search', category: 'Go to', label: 'Search', icon: <Search size={13} />, action: () => goTo('search') },
    { id: 'go-chat', category: 'Go to', label: 'AI Chat', icon: <MessageSquare size={13} />, action: () => goTo('chat') },
    { id: 'go-audit', category: 'Go to', label: 'Audit Trail', icon: <ShieldCheck size={13} />, action: () => goTo('audit') },
    { id: 'go-settings', category: 'Go to', label: 'Settings', icon: <Settings size={13} />, shortcut: '⌘,', action: () => goTo('settings') },

    { id: 'open-folder', category: 'File', label: 'Open Folder…', icon: <FolderInput size={13} />, action: () => { openFolder(); close() } },
    { id: 'quick-open', category: 'File', label: 'Go to File', icon: <FolderOpen size={13} />, shortcut: '⌘P', action: () => { setQuickOpenOpen(true); close() } },
    { id: 'symbol-search', category: 'File', label: 'Go to Symbol in Workspace', icon: <Hash size={13} />, shortcut: '⌘T', action: () => { setSymbolSearchOpen(true); close() } },
    { id: 'go-to-line', category: 'File', label: 'Go to Line…', icon: <Hash size={13} />, shortcut: '⌘G', action: () => { openGoToLine(); close() } },
    { id: 'close-tabs', category: 'File', label: 'Close All Tabs', icon: <Trash2 size={13} />, action: () => { closeAllTabs(); close() } },
    { id: 'rebuild-index', category: 'File', label: 'Rebuild Codebase Index', icon: <RefreshCw size={13} />, action: async () => { await window.api.search.buildIndex(); close() } },

    { id: 'toggle-sidebar', category: 'View', label: 'Toggle Sidebar', icon: <PanelLeft size={13} />, shortcut: '⌘B', action: () => { toggleSidebar(); close() } },
    { id: 'toggle-terminal', category: 'View', label: 'Toggle Terminal', icon: <PanelBottom size={13} />, shortcut: '⌘`', action: () => { toggleBottomPanel(); close() } },
    { id: 'shortcuts', category: 'View', label: 'Keyboard Shortcuts', icon: <Keyboard size={13} />, shortcut: '⌘/', action: () => { setShortcutsOpen(true); close() } },
  ]

  const filtered = commands
    .filter((c) => fuzzyMatch(query, c.label) || fuzzyMatch(query, c.category))
    .sort((a, b) => fuzzyScore(query, b.label) - fuzzyScore(query, a.label))

  const grouped: Record<string, Command[]> = {}
  for (const cmd of filtered) {
    if (!grouped[cmd.category]) grouped[cmd.category] = []
    grouped[cmd.category].push(cmd)
  }

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

  const run = useCallback((cmd: Command) => {
    cmd.action()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) run(filtered[selectedIndex])
    } else if (e.key === 'Escape') {
      close()
    }
  }

  if (!open) return null

  let flatIdx = 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
      onClick={close}
    >
      <div
        style={{
          width: 580,
          maxWidth: '90vw',
          background: surface.void,
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
          <Search size={15} color={fg[3]} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search…"
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

        <div ref={listRef} style={{ maxHeight: 400, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: fg[3], fontSize: 12 }}>
              No commands match &quot;{query}&quot;
            </div>
          )}

          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category}>
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
                {category}
              </div>
              {cmds.map((cmd) => {
                const idx = flatIdx++
                const isSelected = idx === selectedIndex
                return (
                  <div
                    key={cmd.id}
                    data-idx={idx}
                    onClick={() => run(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 14px',
                      cursor: 'pointer',
                      background: isSelected ? accent.amber.subtle : 'transparent',
                      borderLeft: isSelected ? `2px solid ${accent.amber.fg}` : '2px solid transparent',
                    }}
                  >
                    <span style={{ color: isSelected ? accent.amber.fg : fg[3], flexShrink: 0 }}>{cmd.icon}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, color: isSelected ? fg[0] : fg[1] }}>{cmd.label}</span>
                      {cmd.description && (
                        <span style={{ display: 'block', fontSize: 10, color: fg[4], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cmd.description}
                        </span>
                      )}
                    </span>
                    {cmd.shortcut && (
                      <kbd
                        style={{
                          fontSize: 10,
                          color: fg[3],
                          background: border[1],
                          border: `1px solid ${border[0]}`,
                          borderRadius: 3,
                          padding: '1px 5px',
                          flexShrink: 0,
                        }}
                      >
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div
          style={{
            padding: '6px 14px',
            borderTop: `1px solid ${border[1]}`,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
          }}
        >
          {[['↑↓', 'navigate'], ['↵', 'run'], ['Esc', 'close']].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <kbd
                style={{
                  fontSize: 9,
                  color: fg[3],
                  background: border[1],
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
          <span style={{ fontSize: 10, color: fg[4] }}>Lakoora</span>
        </div>
      </div>
    </div>
  )
}
