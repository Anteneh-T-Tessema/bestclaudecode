import { useMemo } from 'react'
import { useEditorStore } from '../../store/useEditorStore'
import { EmptyState } from '../EmptyState'
import { List } from 'lucide-react'
import { accent, border, fg, surface } from '../../design'

type SymbolKind = 'function' | 'class' | 'interface' | 'method' | 'type' | 'enum' | 'variable'

interface OutlineSymbol {
  name: string
  kind: SymbolKind
  line: number
  indent: number
}

const KIND_COLOR: Record<SymbolKind, string> = {
  function:  accent.blue.fg,
  class:     accent.amber.fg,
  interface: accent.cyan.fg,
  method:    accent.violet.fg,
  type:      accent.green.fg,
  enum:      accent.red.fg,
  variable:  fg[2],
}

const KIND_BADGE: Record<SymbolKind, string> = {
  function:  'ƒ',
  class:     'C',
  interface: 'I',
  method:    'm',
  type:      'T',
  enum:      'E',
  variable:  'v',
}

function extractSymbols(content: string, language: string): OutlineSymbol[] {
  const lines = content.split('\n')
  const symbols: OutlineSymbol[] = []

  const push = (name: string, kind: SymbolKind, lineIdx: number, indent = 0) => {
    symbols.push({ name, kind, line: lineIdx + 1, indent })
  }

  if (language === 'typescript' || language === 'javascript') {
    lines.forEach((line, i) => {
      const t = line.trimStart()
      const ind = line.length - t.length
      let m: RegExpMatchArray | null

      m = t.match(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+(\w+)/)
      if (m) { push(m[1], 'function', i, ind); return }

      m = t.match(/^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/)
      if (m) { push(m[1], 'class', i, ind); return }

      m = t.match(/^(?:export\s+)?interface\s+(\w+)/)
      if (m) { push(m[1], 'interface', i, ind); return }

      m = t.match(/^(?:export\s+)?type\s+(\w+)\s*[=<]/)
      if (m) { push(m[1], 'type', i, ind); return }

      m = t.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/)
      if (m) { push(m[1], 'enum', i, ind); return }

      // const/let arrow functions & function expressions
      m = t.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function[\s*(])/)
      if (m) { push(m[1], 'function', i, ind); return }

      // Class methods (indented, followed by `(`)
      m = t.match(/^(?:(?:private|public|protected|static|async|override|abstract|get|set)\s+)*(\w+)\s*[<(]/)
      if (m && ind > 0) {
        const skip = ['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'import', 'export', 'const', 'let', 'var', 'type', 'interface', 'class', 'enum', 'function']
        if (!skip.includes(m[1]) && /^[a-z_$]/i.test(m[1])) push(m[1], 'method', i, ind)
      }
    })
  } else if (language === 'python') {
    lines.forEach((line, i) => {
      const t = line.trimStart()
      const ind = line.length - t.length
      let m: RegExpMatchArray | null
      m = t.match(/^(?:async\s+)?def\s+(\w+)/)
      if (m) { push(m[1], ind === 0 ? 'function' : 'method', i, ind); return }
      m = t.match(/^class\s+(\w+)/)
      if (m) push(m[1], 'class', i, ind)
    })
  } else if (language === 'go') {
    lines.forEach((line, i) => {
      const t = line.trimStart()
      let m: RegExpMatchArray | null
      m = t.match(/^func\s+(?:\([^)]*\)\s+)?(\w+)/)
      if (m) { push(m[1], 'function', i); return }
      m = t.match(/^type\s+(\w+)\s+(?:struct|interface)/)
      if (m) push(m[1], t.includes('interface') ? 'interface' : 'class', i)
    })
  } else if (language === 'rust') {
    lines.forEach((line, i) => {
      const t = line.trimStart()
      let m: RegExpMatchArray | null
      m = t.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/)
      if (m) { push(m[1], 'function', i); return }
      m = t.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+(\w+)/)
      if (m) push(m[1], t.includes('trait') ? 'interface' : t.includes('enum') ? 'enum' : 'class', i)
    })
  } else if (language === 'java' || language === 'csharp' || language === 'kotlin') {
    lines.forEach((line, i) => {
      const t = line.trimStart()
      const ind = line.length - t.length
      let m: RegExpMatchArray | null
      m = t.match(/^(?:(?:public|private|protected|static|abstract|final|override|virtual|async)\s+)*(?:class|record)\s+(\w+)/)
      if (m) { push(m[1], 'class', i, ind); return }
      m = t.match(/^(?:(?:public|private|protected|static|abstract|final|override|virtual|async)\s+)*(?:interface)\s+(\w+)/)
      if (m) { push(m[1], 'interface', i, ind); return }
      m = t.match(/^(?:(?:public|private|protected|static|abstract|final|override|virtual|async|\w+)\s+)+(\w+)\s*\(/)
      if (m && ind > 0) {
        const skip = ['if', 'for', 'while', 'switch', 'catch', 'return', 'new']
        if (!skip.includes(m[1])) push(m[1], 'method', i, ind)
      }
    })
  }

  return symbols
}

export function OutlinePanel() {
  const activeTab = useEditorStore((s) => s.getActiveTab())

  const symbols = useMemo(() => {
    if (!activeTab) return []
    return extractSymbols(activeTab.content, activeTab.language)
  }, [activeTab?.id, activeTab?.content, activeTab?.language])

  if (!activeTab) {
    return (
      <EmptyState
        icon={<List size={20} />}
        title="No file open"
        description="Open a file to see its outline."
      />
    )
  }

  if (symbols.length === 0) {
    return (
      <EmptyState
        icon={<List size={20} />}
        title="No symbols"
        description="No functions, classes, or types found."
      />
    )
  }

  const goTo = (line: number) => {
    window.dispatchEvent(new CustomEvent('lakoora:goToLine', { detail: { line, column: 1 } }))
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {symbols.map((sym, idx) => (
        <button
          key={`${sym.line}-${idx}`}
          type="button"
          onClick={() => goTo(sym.line)}
          title={`${sym.kind} · line ${sym.line}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            width: '100%',
            padding: `3px 10px 3px ${10 + sym.indent * 0.5}px`,
            background: 'none',
            border: 'none',
            borderBottom: `1px solid ${border[2]}`,
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = surface.overlay }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
        >
          <span style={{
            width: 14,
            fontSize: 10,
            fontWeight: 700,
            color: KIND_COLOR[sym.kind],
            fontFamily: 'monospace',
            flexShrink: 0,
            textAlign: 'center',
          }}>
            {KIND_BADGE[sym.kind]}
          </span>
          <span style={{
            fontSize: 11,
            color: fg[1],
            fontFamily: 'monospace',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {sym.name}
          </span>
          <span style={{ fontSize: 9, color: fg[4], flexShrink: 0 }}>
            {sym.line}
          </span>
        </button>
      ))}
    </div>
  )
}
