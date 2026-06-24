import { useState, useEffect, useCallback } from 'react'
import { Database, Trash2 } from 'lucide-react'
import { accent, border, fg, surface } from '../../design'
import { toast } from '../../store/useToastStore'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Gap 72 — context cache health panel: shows .context-cache/ file count + size, clear button. */
export function CacheSection() {
  const [stats, setStats] = useState<{ total: number; bytes: number } | null>(null)
  const [clearing, setClearing] = useState(false)

  const loadStats = useCallback(() => {
    window.api.context.cacheStats().then(setStats).catch(() => setStats({ total: 0, bytes: 0 }))
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const clearCache = useCallback(async () => {
    setClearing(true)
    try {
      const { deleted } = await window.api.context.evictCache(0)
      toast.success(`Cleared ${deleted} cache file${deleted === 1 ? '' : 's'}`)
      loadStats()
    } catch {
      toast.error('Failed to clear context cache')
    } finally {
      setClearing(false)
    }
  }, [loadStats])

  return (
    <div>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: fg[3], marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${border[1]}`,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Database size={11} color={accent.blue.fg} /> Context Cache (.context-cache/)
      </div>
      <p style={{ fontSize: 10, color: fg[3], margin: '0 0 10px', lineHeight: 1.5 }}>
        Caches assembled context prompts keyed by repo fingerprint + task. Grows as you work;
        clearing it forces a fresh context build on the next query.
      </p>

      {stats && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: fg[0], fontFamily: 'monospace' }}>{stats.total}</div>
              <div style={{ fontSize: 9, color: fg[4] }}>cached files</div>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: fg[0], fontFamily: 'monospace' }}>{formatBytes(stats.bytes)}</div>
              <div style={{ fontSize: 9, color: fg[4] }}>on disk</div>
            </div>
          </div>

          <button
            type="button"
            onClick={clearCache}
            disabled={clearing || stats.total === 0}
            title="Delete all .context-cache/ files"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
              fontSize: 10, fontWeight: 600, borderRadius: 4,
              border: `1px solid ${border[0]}`,
              background: surface.raised, color: stats.total === 0 ? fg[4] : accent.red.fg,
              cursor: stats.total > 0 && !clearing ? 'pointer' : 'not-allowed',
            }}
          >
            <Trash2 size={10} />
            {clearing ? 'Clearing…' : 'Clear cache'}
          </button>
        </div>
      )}
    </div>
  )
}
