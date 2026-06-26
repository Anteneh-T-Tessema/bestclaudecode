import { useState, useCallback, useRef } from 'react'
import { Globe, RefreshCw, Camera, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'

export function BrowserPreviewPanel() {
  const [url, setUrl] = useState('https://example.com')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)

  const navigate = useCallback(async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    setTitle(null)
    try {
      const result = await window.api.browser.navigate(url.trim())
      if (result.ok) {
        setTitle(result.title ?? null)
      } else {
        setError(result.error ?? 'Navigation failed')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [url])

  const takeScreenshot = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.browser.screenshot()
      if (result.dataUrl) {
        setDataUrl(result.dataUrl)
      } else {
        setError(result.error ?? 'Screenshot failed')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchLogs = useCallback(async () => {
    try {
      const fetched = await window.api.browser.consoleLogs()
      setLogs(fetched)
      setLogsOpen(true)
    } catch { /* ignore */ }
  }, [])

  const clearLogs = useCallback(async () => {
    await window.api.browser.clearLogs()
    setLogs([])
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigate()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Globe style={{ width: 13, height: 13, color: accent.cyan.fg }} />}
        label="Browser Preview"
      />

      {/* URL bar */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={urlInputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://example.com"
            style={{
              flex: 1,
              background: surface.raised,
              border: `1px solid ${border[0]}`,
              borderRadius: 5,
              padding: '5px 8px',
              fontSize: 11,
              color: fg[0],
              outline: 'none',
              fontFamily: 'monospace',
            }}
          />
          <button
            type="button"
            onClick={navigate}
            disabled={loading}
            title="Navigate"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 5,
              background: loading ? surface.raised : accent.cyan.fg,
              border: 'none', color: loading ? fg[4] : '#000',
              cursor: loading ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}
          >
            <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? 'Loading…' : 'Go'}
          </button>
          <button
            type="button"
            onClick={takeScreenshot}
            disabled={loading}
            title="Capture screenshot"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 5,
              background: surface.raised, border: `1px solid ${border[0]}`,
              color: fg[2], cursor: loading ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}
          >
            <Camera size={11} />
          </button>
        </div>

        {title && (
          <div style={{ marginTop: 4, fontSize: 10, color: accent.cyan.fg, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 4, fontSize: 10, color: accent.red.fg, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}
      </div>

      {/* Screenshot display */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dataUrl ? (
          <div style={{ border: `1px solid ${border[1]}`, borderRadius: 6, overflow: 'hidden' }}>
            <img
              src={dataUrl}
              alt="Browser screenshot"
              style={{ width: '100%', display: 'block' }}
            />
          </div>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: fg[4], fontSize: 11, flexDirection: 'column', gap: 8, padding: 24,
          }}>
            <Globe size={32} color={fg[4]} />
            <span>Navigate to a URL, then click the camera icon to capture a screenshot.</span>
          </div>
        )}

        {/* Console logs section */}
        <div style={{ border: `1px solid ${border[1]}`, borderRadius: 6, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => { void fetchLogs(); setLogsOpen((o) => !o) }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', background: surface.raised, border: 'none',
              cursor: 'pointer', color: fg[2], fontSize: 10, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}
          >
            {logsOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Console Logs
            {logs.length > 0 && (
              <span style={{
                marginLeft: 'auto', fontSize: 9, padding: '1px 5px', borderRadius: 10,
                background: accent.amber.subtle, color: accent.amber.fg,
                border: `1px solid ${accent.amber.border}`,
              }}>
                {logs.length}
              </span>
            )}
            {logs.length > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void clearLogs() }}
                title="Clear logs"
                style={{
                  display: 'flex', alignItems: 'center',
                  background: 'transparent', border: 'none',
                  color: fg[4], cursor: 'pointer', padding: 2,
                }}
              >
                <Trash2 size={10} />
              </button>
            )}
          </button>
          {logsOpen && (
            <div style={{
              maxHeight: 160, overflowY: 'auto',
              background: surface.void,
              borderTop: `1px solid ${border[2]}`,
            }}>
              {logs.length === 0 ? (
                <div style={{ padding: '8px 10px', fontSize: 10, color: fg[4] }}>No console logs yet.</div>
              ) : (
                logs.slice(-20).map((log, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '2px 10px',
                      fontSize: 9.5,
                      fontFamily: 'monospace',
                      color: log.includes('[error]') ? accent.red.fg : fg[3],
                      borderBottom: `1px solid ${border[2]}30`,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {log}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
