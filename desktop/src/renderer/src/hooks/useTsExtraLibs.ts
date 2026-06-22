import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { useEditorStore } from '../store/useEditorStore'

function fileToUri(filePath: string): string {
  return `file://${filePath}`
}

/**
 * Feeds every open TS/JS tab into Monaco's bundled TypeScript language service as an
 * "extra lib" so go-to-definition, hover, and diagnostics see real cross-file types —
 * without spinning up an external tsserver process. Limited to currently-open tabs
 * (not the whole project) to keep this cheap and avoid indexing node_modules.
 */
export function useTsExtraLibs(): void {
  const tabs = useEditorStore((s) => s.tabs)
  const disposablesRef = useRef<Map<string, monaco.IDisposable>>(new Map())

  useEffect(() => {
    const tsJsTabs = tabs.filter((t) => t.language === 'typescript' || t.language === 'javascript')
    const liveUris = new Set(tsJsTabs.map((t) => fileToUri(t.filePath)))

    for (const tab of tsJsTabs) {
      const uri = fileToUri(tab.filePath)
      disposablesRef.current.get(uri)?.dispose()
      const disposable = monaco.languages.typescript.typescriptDefaults.addExtraLib(tab.content, uri)
      disposablesRef.current.set(uri, disposable)
    }

    for (const [uri, disposable] of disposablesRef.current) {
      if (!liveUris.has(uri)) {
        disposable.dispose()
        disposablesRef.current.delete(uri)
      }
    }
  }, [tabs])
}
