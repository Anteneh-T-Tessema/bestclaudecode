import { useState, useRef, useCallback, useEffect } from 'react'
import { RotateCw, Globe, AlertCircle, MousePointerClick } from 'lucide-react'
import { surface, border, fg, accent } from '../../design'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { WebviewElement, ConsoleMessageEvent } from '../../types/webview'
import { InspectResultCard } from './InspectResultCard'
import { toast } from '../../store/useToastStore'

// HTMLWebViewElement (declared by @types/react) is an empty marker interface —
// cast through it to access the actual Electron webview methods/events.
function asWebviewElement(el: HTMLWebViewElement | null): WebviewElement | null {
  return el as unknown as WebviewElement | null
}

const DEFAULT_URL = 'http://localhost:3000'

const CLICK_PREFIX = '__MESHFLOW_CLICK__'

// Injected into the webview when inspect mode is on. Uses console.log as the
// guest→host channel (Electron webview console-message event).
const INSPECTOR_SCRIPT = `
(function() {
  if (window.__meshflowInspect) {
    window.__meshflowInspect.targets.forEach(function(el) {
      el.removeEventListener('mouseenter', window.__meshflowInspect.onEnter);
      el.removeEventListener('mouseleave', window.__meshflowInspect.onLeave);
      el.removeEventListener('click', window.__meshflowInspect.onClick, true);
    });
  }
  var lastHovered = null;
  var allEls = Array.from(document.querySelectorAll('*'));
  function onEnter(e) { e.target.style.outline = '2px solid #7c3aed'; lastHovered = e.target; }
  function onLeave(e) { e.target.style.outline = ''; }
  function onClick(e) {
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    var info = {
      tagName: el.tagName.toLowerCase(),
      className: (el.className || ''),
      id: el.id || '',
      textContent: (el.textContent || '').trim().slice(0, 200)
    };
    console.log('${CLICK_PREFIX}' + JSON.stringify(info));
  }
  allEls.forEach(function(el) {
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('click', onClick, true);
  });
  window.__meshflowInspect = { targets: allEls, onEnter: onEnter, onLeave: onLeave, onClick: onClick };
})();
`

const CLEANUP_SCRIPT = `
(function() {
  if (!window.__meshflowInspect) return;
  window.__meshflowInspect.targets.forEach(function(el) {
    el.style.outline = '';
    el.removeEventListener('mouseenter', window.__meshflowInspect.onEnter);
    el.removeEventListener('mouseleave', window.__meshflowInspect.onLeave);
    el.removeEventListener('click', window.__meshflowInspect.onClick, true);
  });
  window.__meshflowInspect = null;
})();
`

interface InspectedElement {
  tagName: string
  className: string
  id: string
  textContent: string
}

// Gap 139 — embeds the user's own running dev server next to the editor,
// Lovable/Emergent-style. Uses Electron's <webview> tag (isolated process,
// requires webviewTag: true in BrowserWindow webPreferences — see
// main/window.ts) when running in Electron, falling back to a sandboxed
// <iframe> in the web/socket build. No port auto-detection: the URL is
// manually entered and remembered per-project (keyed by projectPath) via
// useSettingsStore, since different projects almost always run on different
// ports/URLs.
export function LivePreview() {
  const projectPath = useSettingsStore((s) => s.projectPath)
  const urlsByProject = useSettingsStore((s) => s.livePreviewUrlsByProject)
  const setSetting = useSettingsStore((s) => s.set)
  const storedUrl = projectPath ? urlsByProject[projectPath] : undefined
  const [urlInput, setUrlInput] = useState(storedUrl || DEFAULT_URL)
  const [activeUrl, setActiveUrl] = useState(storedUrl || DEFAULT_URL)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [inspectMode, setInspectMode] = useState(false)
  const [inspectedElement, setInspectedElement] = useState<InspectedElement | null>(null)
  const webviewRef = useRef<HTMLWebViewElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const isElectron = typeof window !== 'undefined' && window.isElectron === true

  // Reload the remembered URL whenever the open project changes. Deliberately
  // not depending on urlsByProject itself, so this doesn't fight the user's
  // in-progress typing every time navigate() below updates the record.
  useEffect(() => {
    const next = projectPath ? urlsByProject[projectPath] : undefined
    setUrlInput(next || DEFAULT_URL)
    setActiveUrl(next || DEFAULT_URL)
    setFailed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  const navigate = useCallback((url: string) => {
    const normalized = /^https?:\/\//.test(url) ? url : `http://${url}`
    setUrlInput(normalized)
    setActiveUrl(normalized)
    setFailed(false)
    if (projectPath) {
      void setSetting('livePreviewUrlsByProject', { ...urlsByProject, [projectPath]: normalized })
    }
  }, [setSetting, projectPath, urlsByProject])

  const refresh = useCallback(() => {
    setFailed(false)
    const webview = asWebviewElement(webviewRef.current)
    if (isElectron && webview) webview.reload()
    else if (iframeRef.current) iframeRef.current.src = activeUrl
  }, [isElectron, activeUrl])

  // Mount-once: show a toast when /scaffold generates a component.
  useEffect(() => {
    const handler = (e: Event) => {
      const componentName = (e as CustomEvent<{ componentName: string }>).detail?.componentName ?? 'Component'
      toast.info(`"${componentName}" scaffolded — click Refresh to preview`)
    }
    window.addEventListener('meshflow:scaffold:generated', handler)
    return () => window.removeEventListener('meshflow:scaffold:generated', handler)
  }, [])

  // Mount-once: register the console-message listener for click results.
  useEffect(() => {
    const webview = asWebviewElement(webviewRef.current)
    if (!isElectron || !webview) return
    const onConsole = (e: ConsoleMessageEvent) => {
      if (!e.message.startsWith(CLICK_PREFIX)) return
      try {
        const info = JSON.parse(e.message.slice(CLICK_PREFIX.length)) as InspectedElement
        setInspectedElement(info)
        setInspectMode(false)
      } catch { /* ignore malformed message */ }
    }
    webview.addEventListener('console-message', onConsole)
    return () => webview.removeEventListener('console-message', onConsole)
  }, [isElectron])

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

  // Inject/remove inspector script when inspectMode changes.
  useEffect(() => {
    const webview = asWebviewElement(webviewRef.current)
    if (!isElectron || !webview) return
    if (inspectMode) {
      webview.executeJavaScript(INSPECTOR_SCRIPT, true).catch(() => {})
    } else {
      webview.executeJavaScript(CLEANUP_SCRIPT, true).catch(() => {})
    }
  }, [inspectMode, isElectron])

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
        {isElectron && (
          <button
            type="button"
            onClick={() => { setInspectMode((m) => !m); setInspectedElement(null) }}
            title={inspectMode ? 'Exit inspect mode' : 'Inspect element (click to edit)'}
            style={{
              background: inspectMode ? accent.violet.subtle : 'none',
              border: `1px solid ${inspectMode ? accent.violet.border : 'transparent'}`,
              borderRadius: 4, cursor: 'pointer',
              color: inspectMode ? accent.violet.fg : fg[3],
              display: 'flex', padding: 3,
            }}
          >
            <MousePointerClick size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], display: 'flex', padding: 3 }}
        >
          <RotateCw size={13} />
        </button>
      </div>

      {inspectedElement && (
        <InspectResultCard
          element={inspectedElement}
          onDismiss={() => setInspectedElement(null)}
        />
      )}

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
