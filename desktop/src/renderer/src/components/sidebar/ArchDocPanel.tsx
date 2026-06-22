import { useState, useCallback } from 'react'
import { BookOpen, RefreshCw, ChevronRight, ChevronDown, Loader2 } from 'lucide-react'
import { PanelHeader, accent, border, fg, surface } from '../../design'
import { EmptyState } from '../EmptyState'
import type { ArchDocResult, ArchModule } from '../../../../main/ipc/archDoc.handlers'

function ModuleRow({ mod }: { mod: ArchModule }) {
  const [open, setOpen] = useState(false)
  const fnCount = mod.functions.length
  const clsCount = mod.classes.length

  return (
    <div style={{ borderBottom: `1px solid ${border[2]}` }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          cursor: 'pointer',
          background: open ? surface.raised : 'transparent',
        }}
      >
        {open ? <ChevronDown size={12} style={{ color: fg[3], flexShrink: 0 }} /> : <ChevronRight size={12} style={{ color: fg[3], flexShrink: 0 }} />}
        <span style={{ fontSize: 12, fontWeight: 600, color: accent.blue.fg, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {mod.module_name}
        </span>
        <span style={{ fontSize: 10, color: fg[4], flexShrink: 0 }}>
          {fnCount > 0 && `${fnCount}fn `}{clsCount > 0 && `${clsCount}cls`}
        </span>
      </div>

      {open && (
        <div style={{ padding: '0 12px 8px 28px' }}>
          {mod.summary && (
            <p style={{ fontSize: 11, color: fg[2], margin: '4px 0 6px', lineHeight: 1.4 }}>{mod.summary}</p>
          )}

          {mod.functions.map((fn) => (
            <div key={fn.name} style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 0' }}>
              <code style={{ fontSize: 11, color: accent.violet.fg, flexShrink: 0 }}>{fn.name}()</code>
              <span style={{ fontSize: 10, color: fg[4] }}>line {fn.lineno}</span>
              {fn.summary && <span style={{ fontSize: 10, color: fg[3], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {fn.summary}</span>}
            </div>
          ))}

          {mod.classes.map((cls) => (
            <div key={cls.name} style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <code style={{ fontSize: 11, color: accent.cyan.fg, flexShrink: 0 }}>class {cls.name}</code>
                <span style={{ fontSize: 10, color: fg[4] }}>line {cls.lineno}</span>
                {cls.summary && <span style={{ fontSize: 10, color: fg[3], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {cls.summary}</span>}
              </div>
              {cls.methods.map((m) => (
                <div key={m.name} style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingLeft: 14, paddingTop: 2 }}>
                  <code style={{ fontSize: 10, color: accent.violet.fg, opacity: 0.8, flexShrink: 0 }}>.{m.name}()</code>
                  <span style={{ fontSize: 10, color: fg[4] }}>:{m.lineno}</span>
                  {m.summary && <span style={{ fontSize: 10, color: fg[3], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.summary}</span>}
                </div>
              ))}
            </div>
          ))}

          {mod.imports.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 10, color: fg[4] }}>
              imports: {mod.imports.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ArchDocPanel() {
  const [data, setData] = useState<ArchDocResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.archDoc.generate()
      setData(result)
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<BookOpen style={{ width: 13, height: 13, color: accent.blue.fg }} />}
        label="Architecture"
        actions={
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            title="Re-generate from source"
            style={{ background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer', color: fg[3], padding: 2 }}
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
          </button>
        }
      />

      {!loaded && !loading && (
        <EmptyState
          icon={<BookOpen size={20} />}
          title="Architecture Doc"
          description="Click refresh to analyse all Python modules and map the codebase structure."
        />
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, color: fg[3], fontSize: 12 }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Analysing {data ? 'modules' : 'codebase'}…
        </div>
      )}

      {!loading && loaded && (!data || data.modules.length === 0) && (
        <EmptyState icon={<BookOpen size={20} />} title="No modules found" description="Make sure the project has a src/ directory." />
      )}

      {!loading && data && data.modules.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '6px 12px 4px', fontSize: 10, color: fg[4], borderBottom: `1px solid ${border[2]}` }}>
            {data.modules.length} modules · click to expand
          </div>
          {data.modules.map((mod) => (
            <ModuleRow key={mod.module_name} mod={mod} />
          ))}
        </div>
      )}
    </div>
  )
}
