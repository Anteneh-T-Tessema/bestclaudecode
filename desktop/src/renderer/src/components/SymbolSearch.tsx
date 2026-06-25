import { useState, useEffect, useRef, useCallback } from 'react'
import { Hash, FileCode } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useEditorStore } from '../store/useEditorStore'
import { accent, border, fg, surface } from '../design'

interface BM25Result {
  score: number
  file: string
  line: string
  lineNumber?: number
}

interface LspSymbol {
  name: string
  kind: number
  location: { uri: string; range: { start: { line: number; character: number } } }
  containerName?: string
}

function lspApiForLanguage(lang: string | undefined) {
  if (!lang) return null
  if (lang === 'python') return window.api.lsp.python
  if (lang === 'typescript' || lang === 'javascript' || lang === 'typescriptreact' || lang === 'javascriptreact') return window.api.lsp.ts
  if (lang === 'go') return window.api.lsp.go
  if (lang === 'rust') return window.api.lsp.rust
  if (lang === 'java') return window.api.lsp.java
  if (lang === 'c' || lang === 'cpp') return window.api.lsp.c
  return null
}

// Gap 106 — "Go to Symbol in Workspace" (⌘T): a floating quick-picker over the
// same BM25 symbol index CodeSearchPanel uses, so jumping to a function or
// class doesn't require first switching to the sidebar.
export function SymbolSearch() {
  const open = useAppStore((s) => s.symbolSearchOpen)
  const setOpen = useAppStore((s) => s.setSymbolSearchOpen)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const openFile = useEditorStore((s) => s.openFile)
  const activeLanguage = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab?.language
  })

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BM25Result[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const lspApi = lspApiForLanguage(activeLanguage)
        const [bm25Res, lspRaw] = await Promise.all([
          window.api.search.bm25(query),
          lspApi ? lspApi.workspaceSymbol(query).catch(() => null) : Promise.resolve(null),
        ])
        const bm25Results: BM25Result[] = bm25Res.results ?? []
        const seen = new Set(bm25Results.map((r) => `${r.file}:${r.lineNumber ?? ''}` ))
        const lspResults: BM25Result[] = ((lspRaw as LspSymbol[] | null) ?? [])
          .map((sym) => {
            const filePath = sym.location.uri.replace(/^file:\/\//, '')
            const lineNumber = sym.location.range.start.line + 1
            const label = sym.containerName ? `${sym.name} — ${sym.containerName}` : sym.name
            return { score: 0, file: filePath, line: label, lineNumber }
          })
          .filter((r) => !seen.has(`${r.file}:${r.lineNumber}`))
        setResults([...bm25Results, ...lspResults])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, activeLanguage])

  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`) as HTMLElement | null
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleOpen = useCallback(async (result: BM25Result) => {
    try {
      const content = await window.api.fs.readFile(result.file)
      openFile(result.file, content)
      const line = result.lineNumber
      if (line) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('lakoora:goToLine', { detail: { line } }))
        }, 80)
      }
    } finally {
      setOpen(false)
    }
  }, [openFile, setOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[selectedIndex]) handleOpen(results[selectedIndex])
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
          <Hash size={15} color={fg[2]} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={projectPath ? 'Go to symbol in workspace…' : 'Open a folder first'}
            disabled={!projectPath}
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
              Searching…
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: fg[3], fontSize: 12 }}>
              No symbols matching &quot;{query}&quot;
            </div>
          )}

          {!loading && !query.trim() && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: fg[4], fontSize: 12 }}>
              Type a function or class name to jump to its definition
            </div>
          )}

          {results.map((result, idx) => {
            const isSelected = idx === selectedIndex
            const relFile = projectPath && result.file.startsWith(projectPath)
              ? result.file.slice(projectPath.length + 1)
              : result.file
            const symbolText = result.line.replace(/^\s*/, '').replace(/ -- line \d+$/, '')
            return (
              <div
                key={`${result.file}-${idx}`}
                data-idx={idx}
                onClick={() => handleOpen(result)}
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
                <FileCode size={13} color={isSelected ? accent.amber.fg : accent.cyan.fg} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontFamily: 'monospace',
                      color: isSelected ? fg[0] : fg[1],
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {symbolText}
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
                    {relFile}{result.lineNumber ? `:${result.lineNumber}` : ''}
                  </div>
                </div>
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
          <span style={{ fontSize: 10, color: fg[4] }}>BM25 + LSP workspace symbols</span>
        </div>
      </div>
    </div>
  )
}
