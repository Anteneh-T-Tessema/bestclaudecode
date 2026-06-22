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

// Expose monaco instance globally to prevent @monaco-editor/react from loading vs/loader.js from a CDN.
// Without this, Monaco tries to fetch its AMD loader from jsdelivr.net, which fails (and crashes
// the React root) in any environment without that specific outbound network access.
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
