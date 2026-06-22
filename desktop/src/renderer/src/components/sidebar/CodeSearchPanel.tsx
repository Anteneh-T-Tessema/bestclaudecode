import { useState, useRef, useCallback } from 'react'
import { Radar, FileCode } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { EmptyState } from '../EmptyState'
import { PanelHeader, accent, border, fg, surface } from '../../design'

interface BM25Result {
  score: number
  file: string
  line: string
  lineNumber?: number
  snippet?: string
}

function ResultRow({ result, projectPath, onOpen }: { result: BM25Result; projectPath: string; onOpen: (file: string, line: number | null) => void }) {
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const lineNum = result.lineNumber ?? null
  const relFile = projectPath && result.file.startsWith(projectPath) ? result.file.slice(projectPath.length + 1) : result.file
  const symbolText = result.line.replace(/^\s*/, '').replace(/ -- line \d+$/, '')

  return (
    <div
      style={{
        borderBottom: `1px solid ${border[2]}`,
        background: hovered ? surface.overlay : 'transparent',
      }}
    >
      <div
        onClick={() => {
          onOpen(result.file, lineNum)
          if (result.snippet) setExpanded((e) => !e)
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ padding: '7px 12px', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileCode size={11} color={accent.cyan.fg} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: fg[1], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {relFile}
            {lineNum ? `:${lineNum}` : ''}
          </span>
          <span style={{ fontSize: 9, color: fg[4], fontFamily: 'monospace' }}>{result.score.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: 11, color: fg[2], fontFamily: 'monospace', marginTop: 2, paddingLeft: 17, whiteSpace: 'pre-wrap' }}>
          {symbolText}
        </div>
      </div>

      {result.snippet && expanded && (
        <pre
          style={{
            margin: 0,
            padding: '6px 12px 8px 28px',
            fontSize: 10,
            fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
            color: fg[2],
            background: surface.void,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            borderTop: `1px solid ${border[2]}`,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {result.snippet}
        </pre>
      )}
    </div>
  )
}

type SearchMode = 'bm25' | 'tfidf' | 'vector'

const MODE_LABELS: Record<SearchMode, string> = { bm25: 'BM25', tfidf: 'TF-IDF', vector: 'Vector' }

export function CodeSearchPanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BM25Result[]>([])
  const [docCount, setDocCount] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [mode, setMode] = useState<SearchMode>('bm25')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const projectPath = useSettingsStore((s) => s.projectPath)
  const openFile = useEditorStore((s) => s.openFile)

  const runSearch = useCallback(async (q: string, m: SearchMode) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    setSearching(true)
    try {
      const res =
        m === 'tfidf' ? await window.api.search.tfidf(q) :
        m === 'vector' ? await window.api.search.vector(q) :
        await window.api.search.bm25(q)
      setResults(res.results)
      setDocCount(res.docCount)
      setSearched(true)
    } finally {
      setSearching(false)
    }
  }, [])

  const handleChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(val, mode), 400)
  }

  const switchMode = (m: SearchMode) => {
    setMode(m)
    if (query.trim()) runSearch(query, m)
  }

  const handleOpen = async (file: string, line: number | null) => {
    try {
      const content = await window.api.fs.readFile(file)
      openFile(file, content)
      if (line) {
        // Give MonacoEditor a tick to mount for the newly-opened tab before jumping.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('lakoora:goToLine', { detail: { line } }))
        }, 80)
      }
    } catch {
      // ignore
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Radar style={{ width: 13, height: 13, color: accent.cyan.fg }} />}
        label="Code Search"
      />

      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(['bm25', 'tfidf', 'vector'] as SearchMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              style={{
                fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${mode === m ? accent.cyan.border : border[1]}`,
                background: mode === m ? accent.cyan.subtle : 'transparent',
                color: mode === m ? accent.cyan.fg : fg[3],
                textTransform: 'uppercase',
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch(query, mode)
          }}
          placeholder={`${MODE_LABELS[mode]} search over repo symbols…`}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 4,
            outline: 'none',
            fontSize: 11,
            color: fg[0],
            padding: '6px 8px',
          }}
        />
        {searched && (
          <p style={{ fontSize: 9, color: fg[4], margin: '6px 0 0' }}>
            {results.length} match{results.length !== 1 ? 'es' : ''} across {docCount} indexed symbols · {MODE_LABELS[mode]}
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!projectPath && (
          <EmptyState
            icon={<Radar size={20} />}
            title="No project open"
            description="Open a folder to search its repo map with BM25 ranking — the same algorithm used to build context for /implement."
          />
        )}
        {projectPath && !searching && searched && results.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: fg[3], fontSize: 11 }}>No matches for &quot;{query}&quot;</div>
        )}
        {projectPath && !searched && (
          <div style={{ padding: 16, textAlign: 'center', color: fg[4], fontSize: 11 }}>
            Type to rank functions and classes by relevance
          </div>
        )}
        {results.map((r, i) => (
          <ResultRow key={i} result={r} projectPath={projectPath} onOpen={handleOpen} />
        ))}
      </div>
    </div>
  )
}
