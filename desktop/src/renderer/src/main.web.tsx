import './index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { createWebApi } from './webApi'

// Identical to main.tsx except for this line: in Electron, contextBridge
// injects window.api before this script ever runs. In the browser there is
// no preload step, so we install the WebSocket-backed equivalent ourselves,
// before App (or anything it imports) can read window.api.
window.api = createWebApi()

if (typeof window !== 'undefined') {
  ;(window as unknown as { monaco: typeof monaco }).monaco = monaco
}

loader.config({ monaco })

const monacoEnvironment = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker }
}

monacoEnvironment.MonacoEnvironment = {
  getWorker: (_workerId: string, label: string) => {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
