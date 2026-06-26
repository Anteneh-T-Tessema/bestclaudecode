import { useState, useCallback } from 'react'
import { Network, Search, CornerDownRight } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'
import { EmptyState } from '../EmptyState'
import { toast } from '../../store/useToastStore'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'

interface CallSite {
  file: string;
  line: number;
}

export function CallGraphPanel() {
  const [fnName, setFnName] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchedFn, setSearchedFn] = useState('')
  const [callers, setCallers] = useState<CallSite[]>([])

  const openFile = useEditorStore((s) => s.openFile)
  const projectPath = useSettingsStore((s) => s.projectPath)

  const searchCallers = useCallback(async () => {
    const term = fnName.trim()
    if (!term) return
    setLoading(true)
    try {
      const results = await window.api.search.callers(term)
      setCallers(results)
      setSearchedFn(term)
    } catch (e) {
      toast.error('Failed to retrieve callers')
      setCallers([])
    } finally {
      setLoading(false)
    }
  }, [fnName])

  const navigateTo = useCallback(async (relFile: string, line: number) => {
    const absolutePath = projectPath ? `${projectPath}/${relFile}` : relFile
    try {
      const content = await window.api.fs.readFile(absolutePath)
      openFile(absolutePath, content)
      if (line) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('meshflow:goToLine', { detail: { line } }))
        }, 80)
      }
    } catch {
      toast.error(`Failed to open file: ${relFile}`)
    }
  }, [projectPath, openFile])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<Network style={{ width: 13, height: 13, color: accent.cyan.fg }} />}
        label="Call Graph"
      />

      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: surface.raised, border: `1px solid ${border[0]}`, borderRadius: 4, padding: '0 6px' }}>
          <input
            value={fnName}
            onChange={(e) => setFnName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void searchCallers() }}
            placeholder="Search function / method..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 11, color: fg[0], padding: '6px 0', fontFamily: 'monospace'
            }}
          />
        </div>
        <button
          type="button"
          onClick={searchCallers}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, flexShrink: 0, borderRadius: 4,
            border: `1px solid ${border[0]}`, background: surface.raised,
            color: fg[2], cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          <Search size={12} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: surface.base }}>
        {!searchedFn ? (
          <EmptyState
            icon={<Network size={28} />}
            title="Browse Call Sites"
            description="Type a function or method name above to visualize all cross-file caller references."
          />
        ) : (
          <div style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: accent.cyan.subtle, color: accent.cyan.fg, border: `1px solid ${accent.cyan.border}` }}>
                FUNCTION
              </span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: fg[0] }}>
                {searchedFn}()
              </span>
            </div>

            <div style={{ fontSize: 9, fontWeight: 700, color: fg[3], textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Referenced at ({callers.length} sites)
            </div>

            {callers.length === 0 ? (
              <div style={{ fontSize: 11, color: fg[3], fontStyle: 'italic', padding: '4px 0' }}>
                No active caller references found in the codebase.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {callers.map((site, idx) => {
                  const parts = site.file.split('/')
                  const filename = parts[parts.length - 1]
                  const folder = parts.slice(0, -1).join('/')
                  
                  return (
                    <button
                      key={`${site.file}-${site.line}-${idx}`}
                      type="button"
                      onClick={() => navigateTo(site.file, site.line)}
                      style={{
                        display: 'flex', flexDirection: 'column', width: '100%',
                        padding: '6px 8px', borderRadius: 4, background: surface.raised,
                        border: `1px solid ${border[0]}`, cursor: 'pointer', textAlign: 'left'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = border[1] }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = border[0] }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%' }}>
                        <CornerDownRight size={10} color={accent.cyan.fg} style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: fg[1], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {filename}:{site.line}
                        </span>
                        <span style={{ fontSize: 9, color: fg[3] }}>
                          Line {site.line}
                        </span>
                      </div>
                      {folder && (
                        <div style={{ fontSize: 9, color: fg[3], paddingLeft: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {folder}/
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
