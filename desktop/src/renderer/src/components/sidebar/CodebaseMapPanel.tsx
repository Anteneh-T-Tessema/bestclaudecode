import { useState, useCallback } from 'react'
import { Map, RefreshCw } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'
import { EmptyState } from '../EmptyState'

/** Gap 79 — shows the fingerprint-cached repo orientation block from src.cached_context.
 *  First load populates (or hits) the .context-cache/; subsequent loads are instant on a cache hit. */
export function CodebaseMapPanel() {
  const [text, setText] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.context.orientation()
      setText(result.text || null)
      setCached(result.cached)
    } catch {
      setText(null)
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Map style={{ width: 13, height: 13, color: accent.cyan.fg }} />}
        label="Codebase Map"
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            title={loading ? 'Building map…' : 'Load / refresh codebase map'}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'transparent', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              color: fg[3], padding: '2px 4px', borderRadius: 3,
            }}
          >
            <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        }
      />

      {text === null ? (
        <EmptyState
          icon={<Map size={28} />}
          title="No codebase map loaded"
          description="Click the refresh button to build the repo orientation map. Results are cached by file fingerprint."
        />
      ) : (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderBottom: `1px solid ${border[1]}`,
            background: surface.raised, flexShrink: 0,
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
              background: cached ? accent.green.subtle : accent.cyan.subtle,
              color: cached ? accent.green.fg : accent.cyan.fg,
              border: `1px solid ${cached ? accent.green.border : accent.cyan.border}`,
            }}>
              {cached ? 'CACHED' : 'FRESH'}
            </span>
            <span style={{ fontSize: 9, color: fg[4] }}>
              {text.split('\n').length} lines
            </span>
          </div>

          <pre style={{
            flex: 1, overflowY: 'auto', margin: 0,
            padding: '10px 12px', fontSize: 10.5, lineHeight: 1.6,
            fontFamily: 'monospace', color: fg[1], background: surface.base,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {text}
          </pre>
        </div>
      )}
    </div>
  )
}
