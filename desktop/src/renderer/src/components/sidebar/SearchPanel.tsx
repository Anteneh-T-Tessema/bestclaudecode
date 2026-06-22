import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, CaseSensitive, ChevronRight, FileText, Replace } from 'lucide-react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useEditorStore } from '../../store/useEditorStore'
import { toast } from '../../store/useToastStore'
import { EmptyState } from '../EmptyState'
import { PanelHeader, accent, border, fg, surface } from '../../design'

interface Match {
  file: string
  line: number
  text: string
  matchStart: number
  matchEnd: number
}

function renderMatchLine(text: string, start: number, end: number) {
  return (
    <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
      {text.slice(0, start)}
      <span style={{ background: `${accent.amber.fg}33`, color: accent.amber.bright, fontWeight: 600 }}>
        {text.slice(start, end)}
      </span>
      {text.slice(end)}
    </span>
  )
}

function MatchRow({ match, onOpen }: { match: Match; onOpen: (m: Match) => void }) {
  const [hovered, setHovered] = useState(false)
  const leadingWhitespace = match.text.length - match.text.trimStart().length

  return (
    <div
      onClick={() => onOpen(match)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '4px 14px 4px 28px',
        cursor: 'pointer',
        background: hovered ? surface.overlay : 'transparent',
      }}
    >
      <span style={{ fontSize: 10, color: fg[4], minWidth: 24, textAlign: 'right', flexShrink: 0 }}>
        {match.line}
      </span>
      <span style={{ fontSize: 11, color: fg[2], whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {renderMatchLine(
          match.text.trimStart(),
          match.matchStart - leadingWhitespace,
          match.matchEnd - leadingWhitespace
        )}
      </span>
    </div>
  )
}

export function SearchPanel() {
  const projectPath = useSettingsStore((s) => s.projectPath)
  const openFile = useEditorStore((s) => s.openFile)

  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<Match[]>([])
  const [searching, setSearching] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [searched, setSearched] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runSearch = useCallback(
    (q: string, cs: boolean) => {
      if (!q.trim() || !projectPath) {
        setResults([])
        setSearched(false)
        return
      }
      setSearching(true)
      window.api.fs
        .searchInFiles(projectPath, q, cs)
        .then((r) => {
          setResults(r)
          setSearched(true)
        })
        .catch(() => {
          setResults([])
          setSearched(true)
        })
        .finally(() => setSearching(false))
    },
    [projectPath]
  )

  const handleChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(val, caseSensitive), 400)
  }

  const toggleCase = () => {
    const next = !caseSensitive
    setCaseSensitive(next)
    if (query) runSearch(query, next)
  }

  const openMatch = async (m: Match) => {
    try {
      const content = await window.api.fs.readFile(m.file)
      openFile(m.file, content)
    } catch {
      // ignore
    }
  }

  const handleReplaceAll = async () => {
    if (!query.trim() || !projectPath) return
    setReplacing(true)
    try {
      const result = await window.api.fs.replaceInFiles(projectPath, query, replacement, caseSensitive)
      toast.success(
        `Replaced ${result.replacements} occurrence${result.replacements !== 1 ? 's' : ''} in ${result.filesChanged} file${result.filesChanged !== 1 ? 's' : ''}`
      )
      setResults([])
      setSearched(false)
    } catch {
      toast.error('Replace failed')
    } finally {
      setReplacing(false)
    }
  }

  const toggleCollapse = (file: string) => {
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  if (!projectPath) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <PanelHeader icon={<Search style={{ width: 13, height: 13, color: accent.cyan.fg }} />} label="Search" />
        <EmptyState icon={<Search size={20} />} title="No project open" description="Open a folder to search across files." />
      </div>
    )
  }

  const grouped: Record<string, Match[]> = {}
  for (const m of results) {
    if (!grouped[m.file]) grouped[m.file] = []
    grouped[m.file].push(m)
  }
  const fileNames = Object.keys(grouped)
  const relPath = (f: string) => (f.startsWith(projectPath) ? f.slice(projectPath.length + 1) : f)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader icon={<Search style={{ width: 13, height: 13, color: accent.cyan.fg }} />} label="Search" />

      <div style={{ borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch(query, caseSensitive)
            }}
            placeholder="Search in files…"
            style={{
              flex: 1,
              background: surface.raised,
              border: `1px solid ${border[0]}`,
              borderRadius: 3,
              outline: 'none',
              fontSize: 12,
              color: fg[0],
              padding: '5px 8px',
            }}
          />
          <button
            type="button"
            onClick={toggleCase}
            title="Match case"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: caseSensitive ? accent.amber.border : surface.overlay,
              color: caseSensitive ? accent.amber.bright : fg[3],
            }}
          >
            <CaseSensitive size={13} />
          </button>
          <button
            type="button"
            onClick={() => setReplaceOpen((r) => !r)}
            title="Toggle replace"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: replaceOpen ? accent.amber.border : surface.overlay,
              color: replaceOpen ? accent.amber.bright : fg[3],
            }}
          >
            <Replace size={13} />
          </button>
        </div>

        {replaceOpen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 8px' }}>
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace with…"
              style={{
                flex: 1,
                background: surface.raised,
                border: `1px solid ${border[0]}`,
                borderRadius: 3,
                outline: 'none',
                fontSize: 12,
                color: fg[1],
                padding: '5px 8px',
              }}
            />
            <button
              type="button"
              onClick={handleReplaceAll}
              disabled={!query.trim() || replacing}
              title="Replace all matches"
              style={{
                padding: '5px 10px',
                borderRadius: 3,
                border: 'none',
                cursor: query.trim() ? 'pointer' : 'default',
                background: query.trim() ? accent.amber.fg : border[1],
                color: query.trim() ? surface.void : fg[4],
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              {replacing ? 'Replacing…' : 'Replace All'}
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {searching && (
          <div style={{ padding: '16px', textAlign: 'center', color: fg[3], fontSize: 11 }}>Searching…</div>
        )}

        {!searching && searched && results.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', color: fg[3], fontSize: 11 }}>
            No results for &quot;{query}&quot;
          </div>
        )}

        {!searching && !searched && (
          <div style={{ padding: '16px', textAlign: 'center', color: fg[4], fontSize: 11 }}>
            Type to search across project files
          </div>
        )}

        {fileNames.map((file) => {
          const matches = grouped[file]
          const isCollapsed = collapsed.has(file)
          const fileName = file.split('/').pop() ?? file
          return (
            <div key={file}>
              <div
                onClick={() => toggleCollapse(file)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  background: surface.raised,
                  borderTop: `1px solid ${border[1]}`,
                }}
              >
                <ChevronRight
                  size={12}
                  color={fg[3]}
                  style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.12s' }}
                />
                <FileText size={12} color={accent.amber.fg} />
                <span style={{ fontSize: 11, fontWeight: 600, color: fg[1] }}>{fileName}</span>
                <span
                  style={{
                    fontSize: 9,
                    color: fg[3],
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {relPath(file)}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: accent.amber.fg,
                    background: accent.amber.subtle,
                    padding: '1px 5px',
                    borderRadius: 10,
                  }}
                >
                  {matches.length}
                </span>
              </div>
              {!isCollapsed && matches.map((m, i) => <MatchRow key={i} match={m} onOpen={openMatch} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
