import { useState } from 'react'
import { X, Bot, Sparkles } from 'lucide-react'
import { surface, fg, border, accent } from '../../design'
import { useChatStore } from '../../store/useChatStore'
import { useAppStore } from '../../store/useAppStore'
import { toast } from '../../store/useToastStore'

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
// edit prompt. "Apply with Agent" spawns a self-healing background agent task
// to directly edit, test, and cherry-pick the visual component in the sandbox.
export function InspectResultCard({ element, onDismiss }: Props) {
  const [promptText, setPromptText] = useState('')
  const [applying, setApplying] = useState(false)
  const activeModel = useChatStore((s) => s.activeModel)
  const setActiveActivity = useAppStore((s) => s.setActiveActivity)
  
  const query = element.textContent || element.className || element.tagName

  const getTargetLocation = async () => {
    try {
      const res = await window.api.search.bm25(query)
      const top = res.results[0]
      return {
        file: top?.file ?? '(unknown)',
        line: top?.lineNumber ?? 1
      }
    } catch {
      return { file: '(unknown)', line: 1 }
    }
  }

  const findAndEdit = async () => {
    const loc = await getTargetLocation()
    const text = element.textContent ? `"${element.textContent.slice(0, 60)}"` : ''
    const cls = element.className ? `class="${element.className}"` : ''
    const desc = [text, cls].filter(Boolean).join(' / ')
    const prefill =
      `The user clicked a <${element.tagName}> element${desc ? ` with ${desc}` : ''} in the live preview. ` +
      `Best-matching source: ${loc.file}:${loc.line}. Propose an edit to implement the desired change.`
    window.dispatchEvent(new CustomEvent('meshflow:chat:prefill', { detail: { content: prefill } }))
    onDismiss()
  }

  const applyWithAgent = async () => {
    if (!promptText.trim() || applying) return
    setApplying(true)
    try {
      const loc = await getTargetLocation()
      const goalText = `Modify the <${element.tagName}> element in the live preview (located at ${loc.file}:${loc.line}) as requested:\n\n"${promptText}"\n\nFind the component, make the edit, run unit tests to verify, and promote or check in the visual changes.`
      
      const detail = await window.api.taskPlanner.create(goalText)
      if (!detail?.slug) {
        toast.error('Failed to create edit task plan')
        setApplying(false)
        return
      }

      const plans = await window.api.taskPlanner.list()
      const summary = plans.find((p) => p.slug === detail.slug)
      if (!summary?.path) {
        toast.error('Could not locate plan file')
        setApplying(false)
        return
      }

      const sessionId = await window.api.agent.startAutonomous({ planFile: summary.path, model: activeModel })
      if (sessionId) {
        toast.success('Visual edit background agent started')
        setActiveActivity('agent')
        onDismiss()
      } else {
        toast.error('Failed to start edit agent session')
      }
    } catch (e) {
      toast.error(`Visual edit failed: ${(e as Error).message}`)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div style={{
      padding: '10px 12px', background: accent.violet.subtle,
      borderBottom: `1px solid ${accent.violet.border}`,
      display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 10.5, color: accent.violet.fg, fontFamily: 'monospace', fontWeight: 600 }}>
            {'<'}{element.tagName}
            {element.id ? ` id="${element.id}"` : ''}
            {element.className ? ` class="${element.className.slice(0, 40)}"` : ''}
            {'>'}
          </span>
          {element.textContent && (
            <span style={{ fontSize: 10, color: fg[2], marginLeft: 6 }}>
              "{element.textContent.slice(0, 60)}"
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg[3], display: 'flex', flexShrink: 0 }}
        >
          <X size={12} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: surface.raised, border: `1px solid ${border[0]}`, borderRadius: 4, padding: '0 6px' }}>
          <input
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void applyWithAgent() }}
            placeholder="Describe visual change (e.g. change color to blue, rename to 'Join Now')..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 11, color: fg[0], padding: '5px 0'
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => void applyWithAgent()}
          disabled={applying || !promptText.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
            padding: '5px 10px', borderRadius: 4, border: `1px solid ${accent.green.border}`,
            background: accent.green.subtle, color: accent.green.fg,
            cursor: applying || !promptText.trim() ? 'not-allowed' : 'pointer',
            opacity: applying || !promptText.trim() ? 0.6 : 1
          }}
        >
          {applying ? <Bot size={11} className="agent-pulse" /> : <Bot size={11} />}
          {applying ? 'Applying…' : 'Apply with Agent'}
        </button>

        <button
          type="button"
          onClick={() => void findAndEdit()}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 4, flexShrink: 0,
            border: `1px solid ${accent.violet.border}`, background: surface.raised,
            color: accent.violet.fg, cursor: 'pointer',
          }}
        >
          <Sparkles size={11} /> Find &amp; Edit
        </button>
      </div>
    </div>
  )
}
