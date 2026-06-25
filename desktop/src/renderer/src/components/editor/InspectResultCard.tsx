import { X } from 'lucide-react'
import { surface, fg, accent } from '../../design'

interface InspectedElement {
  tagName: string
  className: string
  id: string
  textContent: string
}

interface Props {
  element: InspectedElement
  onDismiss: () => void
}

// Gap click-to-edit: card shown below the LivePreview toolbar when the user
// clicks an element in inspect mode. "Find & Edit" runs a BM25 search using
// the element's text/class, then pre-fills the chat input with a targeted
// edit prompt — the user reviews before sending (human-gate preserved).
export function InspectResultCard({ element, onDismiss }: Props) {
  const query = element.textContent || element.className || element.tagName

  const findAndEdit = async () => {
    try {
      const res = await window.api.search.bm25(query)
      const top = res.results[0]
      const file = top?.file ?? '(unknown)'
      const line = top?.lineNumber ?? 1
      const text = element.textContent ? `"${element.textContent.slice(0, 60)}"` : ''
      const cls = element.className ? `class="${element.className}"` : ''
      const desc = [text, cls].filter(Boolean).join(' / ')
      const prefill =
        `The user clicked a <${element.tagName}> element${desc ? ` with ${desc}` : ''} in the live preview. ` +
        `Best-matching source: ${file}:${line}. Propose an edit to implement the desired change.`
      window.dispatchEvent(new CustomEvent('lakoora:chat:prefill', { detail: { content: prefill } }))
      onDismiss()
    } catch {
      // Search failed — still prefill without a file reference
      const prefill = `The user clicked a <${element.tagName}> element in the live preview. Propose an edit.`
      window.dispatchEvent(new CustomEvent('lakoora:chat:prefill', { detail: { content: prefill } }))
      onDismiss()
    }
  }

  return (
    <div style={{
      padding: '7px 10px', background: accent.violet.subtle,
      borderBottom: `1px solid ${accent.violet.border}`,
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 10, color: accent.violet.fg, fontFamily: 'monospace' }}>
          {'<'}{element.tagName}
          {element.id ? ` id="${element.id}"` : ''}
          {element.className ? ` class="${element.className.slice(0, 40)}"` : ''}
          {'>'}
        </span>
        {element.textContent && (
          <span style={{ fontSize: 10, color: fg[2], marginLeft: 6 }}>
            {element.textContent.slice(0, 60)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => void findAndEdit()}
        style={{
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, flexShrink: 0,
          border: `1px solid ${accent.violet.border}`, background: surface.raised,
          color: accent.violet.fg, cursor: 'pointer',
        }}
      >
        Find &amp; Edit
      </button>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], display: 'flex', flexShrink: 0 }}
      >
        <X size={12} />
      </button>
    </div>
  )
}
