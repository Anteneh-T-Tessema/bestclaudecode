import { useState, useRef, useCallback, useEffect } from 'react'
import { RotateCw, Globe, AlertCircle } from 'lucide-react'
import { surface, border, fg, accent } from '../../design'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { WebviewElement } from '../../types/webview'

// HTMLWebViewElement (declared by @types/react) is an empty marker interface —
// cast through it to access the actual Electron webview methods/events.
function asWebviewElement(el: HTMLWebViewElement | null): WebviewElement | null {
  return el as unknown as WebviewElement | null
}

const DEFAULT_URL = 'http://localhost:3000'

// Gap 139 — embeds the user's own running dev server next to the editor,
// Lovable/Emergent-style. Uses Electron's <webview> tag (isolated process,
// requires webviewTag: true in BrowserWindow webPreferences — see
// main/window.ts) when running in Electron, falling back to a sandboxed
// <iframe> in the web/socket build. No port auto-detection: the URL is
// manually entered and remembered across sessions via useSettingsStore.
export function LivePreview() {
  const storedUrl = useSettingsStore((s) => s.livePreviewUrl)
  const setSetting = useSettingsStore((s) => s.set)
  const [urlInput, setUrlInput] = useState(storedUrl || DEFAULT_URL)
  const [activeUrl, setActiveUrl] = useState(storedUrl || DEFAULT_URL)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const webviewRef = useRef<HTMLWebViewElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const isElectron = typeof window !== 'undefined' && window.isElectron === true

  const navigate = useCallback((url: string) => {
    const normalized = /^https?:\/\//.test(url) ? url : `http://${url}`
    setUrlInput(normalized)
    setActiveUrl(normalized)
    setFailed(false)
    void setSetting('livePreviewUrl', normalized)
  }, [setSetting])

  const refresh = useCallback(() => {
    setFailed(false)
    const webview = asWebviewElement(webviewRef.current)
    if (isElectron && webview) webview.reload()
    else if (iframeRef.current) iframeRef.current.src = activeUrl
  }, [isElectron, activeUrl])

  useEffect(() => {
    const webview = asWebviewElement(webviewRef.current)
    if (!isElectron || !webview) return
    const onStart = () => { setLoading(true); setFailed(false) }
    const onStop = () => setLoading(false)
    const onFail = () => { setLoading(false); setFailed(true) }
    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', onStop)
    webview.addEventListener('did-fail-load', onFail)
    return () => {
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', onStop)
      webview.removeEventListener('did-fail-load', onFail)
    }
  }, [isElectron])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
        borderBottom: `1px solid ${border[1]}`, background: surface.void, flexShrink: 0,
      }}>
        <Globe size={12} color={fg[3]} style={{ flexShrink: 0 }} />
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(urlInput) }}
          onBlur={() => navigate(urlInput)}
          placeholder={DEFAULT_URL}
          style={{
            flex: 1, background: surface.raised, border: `1px solid ${border[0]}`, borderRadius: 4,
            padding: '3px 7px', fontSize: 11, color: fg[0], outline: 'none', fontFamily: 'monospace',
          }}
        />
        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], display: 'flex', padding: 3 }}
        >
          <RotateCw size={13} />
        </button>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff' }}>
        {isElectron ? (
          <webview
            ref={webviewRef}
            src={activeUrl}
            style={{ width: '100%', height: '100%', display: failed ? 'none' : 'flex' }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            src={activeUrl}
            sandbox="allow-scripts allow-same-origin allow-forms"
            onLoad={() => { setLoading(false); setFailed(false) }}
            onError={() => { setLoading(false); setFailed(true) }}
            style={{ width: '100%', height: '100%', border: 'none', display: failed ? 'none' : 'block' }}
          />
        )}

        {loading && !failed && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: accent.cyan.fg, opacity: 0.6,
          }} />
        )}

        {failed && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8, background: surface.base,
          }}>
            <AlertCircle size={20} color={accent.red.fg} />
            <span style={{ fontSize: 12, color: fg[2], textAlign: 'center', maxWidth: 280 }}>
              Couldn&apos;t connect to {activeUrl} — is your dev server running?
            </span>
            <button
              type="button"
              onClick={refresh}
              style={{
                fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 4,
                border: `1px solid ${border[0]}`, background: surface.raised, color: fg[2], cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
