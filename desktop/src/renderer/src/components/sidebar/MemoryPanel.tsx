import { useState, useEffect, useCallback, useRef } from 'react'
import { Brain, RefreshCw, Search } from 'lucide-react'
import { EmptyState } from '../EmptyState'
import { PanelHeader, IconButton, accent, border, fg, surface } from '../../design'

interface MemoryEntry {
  key: string
  content: string
  tags: string[]
  created_at: string
  updated_at: string
  source_task: string
}

function EntryCard({ entry }: { entry: MemoryEntry }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${border[2]}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: fg[0], fontFamily: 'monospace' }}>{entry.key}</span>
        <span style={{ fontSize: 9, color: fg[4], marginLeft: 'auto' }}>{entry.updated_at.slice(0, 10)}</span>
      </div>
      {entry.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
          {entry.tags.map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 9,
                color: accent.violet.fg,
                background: accent.violet.subtle,
                border: `1px solid ${accent.violet.border}`,
                padding: '1px 5px',
                borderRadius: 10,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <p style={{ fontSize: 11, color: fg[2], lineHeight: 1.5, margin: 0 }}>{entry.content}</p>
    </div>
  )
}

export function MemoryPanel() {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.memory.list()
      setEntries(result)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        if (val.trim()) {
          setEntries(await window.api.memory.query(val))
        } else {
          setEntries(await window.api.memory.list())
        }
      } finally {
        setLoading(false)
      }
    }, 400)
  }

  const headerActions = (
    <IconButton size={22} onClick={refresh} disabled={loading} title="Refresh">
      <RefreshCw style={{ width: 11, height: 11 }} className={loading ? 'agent-pulse' : ''} />
    </IconButton>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Brain style={{ width: 13, height: 13, color: accent.violet.fg }} />}
        label="Memory"
        actions={headerActions}
      />

      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 4,
            padding: '0 8px',
          }}
        >
          <Search size={12} color={fg[3]} />
          <input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search past learnings…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 11,
              color: fg[0],
              padding: '6px 0',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!loading && entries.length === 0 && (
          <EmptyState
            icon={<Brain size={20} />}
            title="No memories yet"
            description="Cross-session memory fills up automatically as /implement cycles run — recurring file-level findings and task outcomes are recorded here."
          />
        )}
        {entries.map((e) => (
          <EntryCard key={e.key} entry={e} />
        ))}
      </div>
    </div>
  )
}
