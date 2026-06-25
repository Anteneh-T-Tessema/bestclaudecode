// Gap 139 — React's own JSX.IntrinsicElements already declares `webview` typed
// as HTMLWebViewElement (see @types/react/global.d.ts + index.d.ts), but that
// type is an empty `interface HTMLWebViewElement extends HTMLElement {}` with
// none of Electron's actual webview methods/events. WebviewElement below adds
// just the subset LivePreview.tsx calls, used via a cast on the element ref
// rather than as the ref's declared type (which stays HTMLWebViewElement to
// satisfy the JSX `ref` prop).
export interface WebviewElement {
  reload(): void
  loadURL(url: string): Promise<void>
  addEventListener(type: 'did-start-loading' | 'did-stop-loading' | 'did-fail-load', listener: (event: Event) => void): void
  removeEventListener(type: 'did-start-loading' | 'did-stop-loading' | 'did-fail-load', listener: (event: Event) => void): void
}
