import { useEditorStore } from '../store/useEditorStore'
import { useEditorActionsStore } from '../store/useEditorActionsStore'
import { useChatStore, MODELS } from '../store/useChatStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useProblemsStore } from '../store/useProblemsStore'
import { useAppStore } from '../store/useAppStore'
import { surface, fg, accent, border } from '../design'
import { GitBranch, GitCommit, AlertCircle, AlertTriangle, Sun, Moon } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

type BlameEntry = { line: number; sha: string; author: string; timestamp: number; summary: string }

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  if (s < 31536000) return `${Math.floor(s / 2592000)}mo ago`
  return `${Math.floor(s / 31536000)}y ago`
}

export function StatusBar() {
  const activeTab = useEditorStore((s) => s.getActiveTab())
  const activeModel = useChatStore((s) => s.activeModel)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const problems = useProblemsStore((s) => s.problems)
  const openProblems = useAppStore((s) => s.openProblems)
  const wordWrap = useSettingsStore((s) => s.wordWrap)
  const minimapOn = useSettingsStore((s) => s.minimap)
  const tabSize = useSettingsStore((s) => s.tabSize)
  const autoSave = useSettingsStore((s) => s.autoSave)
  const formatOnSave = useSettingsStore((s) => s.formatOnSave)
  const inlayHints = useSettingsStore((s) => s.inlayHints)
  const stickyScroll = useSettingsStore((s) => s.stickyScroll)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const theme = useSettingsStore((s) => s.theme)
  const setEditorSetting = useSettingsStore((s) => s.set)
  const livePreviewOpen = useEditorActionsStore((s) => s.livePreviewOpen)
  const toggleLivePreview = useEditorActionsStore((s) => s.toggleLivePreview)
  const [branch, setBranch] = useState<string | null>(null)
  const [blameMap, setBlameMap] = useState<Map<number, BlameEntry>>(new Map())
  const blamePath = useRef<string | null>(null)

  useEffect(() => {
    if (!projectPath) return
    window.api.git.branch(projectPath).then(setBranch).catch(() => setBranch(null))
  }, [projectPath])

  useEffect(() => {
    const filePath = activeTab?.filePath
    if (!filePath || !projectPath) {
      setBlameMap(new Map())
      blamePath.current = null
      return
    }
    if (filePath === blamePath.current) return
    blamePath.current = filePath
    window.api.git.blame(projectPath, filePath)
      .then((entries) => {
        if (filePath !== blamePath.current) return
        const m = new Map<number, BlameEntry>()
        for (const e of entries) m.set(e.line, e as BlameEntry)
        setBlameMap(m)
      })
      .catch(() => { if (filePath === blamePath.current) setBlameMap(new Map()) })
  }, [activeTab?.filePath, projectPath])

  const modelLabel = MODELS.find((m) => m.id === activeModel)?.label ?? activeModel
  const errorCount = problems.filter((p) => p.severity === 'error').length
  const warnCount = problems.filter((p) => p.severity === 'warning').length
  const cursorLine = activeTab?.cursorLine
  const blame = cursorLine !== undefined ? blameMap.get(cursorLine) : undefined
  const blameVisible = blame && !blame.sha.startsWith('0000000')

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '0 10px',
    height: '100%',
    fontSize: 11,
    color: fg[1],
    cursor: 'default',
    userSelect: 'none',
    borderRight: `1px solid ${border[2]}`,
  }

  return (
    <div
      style={{
        height: 22,
        background: surface.void,
        borderTop: `1px solid ${border[2]}`,
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Left side */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        {branch && (
          <div style={itemStyle}>
            <GitBranch size={12} style={{ color: accent.green.fg }} />
            <span>{branch}</span>
          </div>
        )}
        {activeTab && (
          <div style={itemStyle}>
            <span style={{ color: fg[2] }}>{activeTab.language}</span>
            {activeTab.cursorLine !== undefined && (
              <span style={{ color: fg[3] }}>
                Ln {activeTab.cursorLine}, Col {activeTab.cursorCol ?? 1}
              </span>
            )}
          </div>
        )}
        {blameVisible && (
          <div
            style={{ ...itemStyle, maxWidth: 240, overflow: 'hidden', cursor: 'default' }}
            title={`${blame.sha} · ${blame.summary}`}
          >
            <GitCommit size={11} style={{ color: accent.cyan.fg, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {blame.author} · {timeAgo(blame.timestamp)}
            </span>
          </div>
        )}
        {(errorCount > 0 || warnCount > 0) && (
          <button
            type="button"
            onClick={openProblems}
            title="Open Problems panel"
            style={{
              ...itemStyle,
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              borderRight: `1px solid ${border[2]}`,
              padding: '0 8px',
              gap: 6,
            }}
          >
            {errorCount > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: accent.red.fg }}>
                <AlertCircle size={11} />
                <span style={{ fontSize: 11 }}>{errorCount}</span>
              </span>
            )}
            {warnCount > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: accent.amber.fg }}>
                <AlertTriangle size={11} />
                <span style={{ fontSize: 11 }}>{warnCount}</span>
              </span>
            )}
          </button>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <button
          type="button"
          onClick={() => setEditorSetting('fontSize', Math.min(28, fontSize + 1))}
          title={`Font size: ${fontSize}px · ⌘+ / ⌘– / ⌘0`}
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}` }}
        >
          {fontSize}px
        </button>
        <button
          type="button"
          onClick={() => setEditorSetting('tabSize', tabSize === 2 ? 4 : 2)}
          title="Toggle indent size"
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}` }}
        >
          Spaces: {tabSize}
        </button>
        <button
          type="button"
          onClick={() => setEditorSetting('wordWrap', !wordWrap)}
          title="Toggle word wrap"
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}`, color: wordWrap ? accent.cyan.fg : fg[1] }}
        >
          Wrap
        </button>
        <button
          type="button"
          onClick={() => setEditorSetting('minimap', !minimapOn)}
          title="Toggle minimap"
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}`, color: minimapOn ? accent.cyan.fg : fg[1] }}
        >
          Map
        </button>
        <button
          type="button"
          onClick={() => setEditorSetting('stickyScroll', !stickyScroll)}
          title="Toggle sticky scroll"
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}`, color: stickyScroll ? accent.cyan.fg : fg[1] }}
        >
          Sticky
        </button>
        <button
          type="button"
          onClick={() => setEditorSetting('autoSave', !autoSave)}
          title="Toggle auto-save (800 ms debounce)"
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}`, color: autoSave ? accent.green.fg : fg[1] }}
        >
          Auto
        </button>
        <button
          type="button"
          onClick={() => setEditorSetting('formatOnSave', !formatOnSave)}
          title="Toggle format-on-save (⌘S runs the language server's formatter first)"
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}`, color: formatOnSave ? accent.cyan.fg : fg[1] }}
        >
          Format
        </button>
        <button
          type="button"
          onClick={() => setEditorSetting('inlayHints', !inlayHints)}
          title="Toggle inlay hints (LSP type annotations and parameter names)"
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}`, color: inlayHints ? accent.cyan.fg : fg[1] }}
        >
          Hints
        </button>
        <button
          type="button"
          onClick={() => toggleLivePreview()}
          title="Toggle Live Preview panel (embeds a running dev server)"
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}`, color: livePreviewOpen ? accent.cyan.fg : fg[1] }}
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => setEditorSetting('theme', theme === 'dark' ? 'light' : 'dark')}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          style={{ ...itemStyle, cursor: 'pointer', background: 'none', border: 'none', borderLeft: `1px solid ${border[2]}`, color: theme === 'light' ? accent.amber.fg : fg[2] }}
        >
          {theme === 'light' ? <Sun size={11} /> : <Moon size={11} />}
        </button>
        <div style={{ ...itemStyle, borderRight: 'none', borderLeft: `1px solid ${border[2]}`, color: accent.violet.fg }}>
          {modelLabel}
        </div>
      </div>
    </div>
  )
}
