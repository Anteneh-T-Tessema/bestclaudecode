import { useState, useEffect } from 'react'
import { FileEdit, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { accent, border, fg, surface } from '../../design'
import type { EditBlock } from '../../lib/editBlocks'
import { diffLines, buildHunks, applyHunks, HunkCard, type Hunk } from '../../lib/hunkDiff'

type Status = 'pending' | 'applied' | 'rejected'

interface EditProposalCardProps {
  block: EditBlock
  onApply?: () => void
  isGroupApplied?: boolean
}

export function EditProposalCard({ block, onApply, isGroupApplied }: EditProposalCardProps) {
  const [expanded, setExpanded] = useState(true)
  const [original, setOriginal] = useState<string | null>(null)
  const [hunks, setHunks] = useState<Hunk[]>([])
  const [accepted, setAccepted] = useState<Set<number>>(new Set())
  const [status, setStatus] = useState<Status>('pending')
  const [loading, setLoading] = useState(true)

  const projectPath = useSettingsStore((s) => s.projectPath)
  const openFile = useEditorStore((s) => s.openFile)
  const updateContent = useEditorStore((s) => s.updateContent)
  const tabs = useEditorStore((s) => s.tabs)

  const absPath = block.path.startsWith('/') ? block.path : `${projectPath}/${block.path}`

  useEffect(() => {
    let cancelled = false
    window.api.fs.readFile(absPath)
      .then((content) => {
        if (cancelled) return
        setOriginal(content)
        const computed = buildHunks(diffLines(content, block.content))
        setHunks(computed)
        setAccepted(new Set(computed.map((h) => h.id)))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setOriginal('')
        const computed = buildHunks(diffLines('', block.content))
        setHunks(computed)
        setAccepted(new Set(computed.map((h) => h.id)))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [absPath, block.content])

  const toggleHunk = (id: number) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = async () => {
    if (original === null) return
    const result = applyHunks(original, hunks, accepted)
    try {
      await window.api.fs.writeFile(absPath, result)
      const openTab = tabs.find((t) => t.filePath === absPath)
      if (openTab) {
        updateContent(openTab.id, result)
      } else {
        openFile(absPath, result)
      }
      setStatus('applied')
      toast.success(`Applied edit to ${block.path}`)
      onApply?.()
    } catch (err) {
      toast.error(`Failed to apply edit: ${(err as Error).message}`)
    }
  }

  const reject = () => setStatus('rejected')

  const effectiveStatus: Status = isGroupApplied && status === 'pending' ? 'applied' : status

  return (
    <div
      style={{
        border: `1px solid ${effectiveStatus === 'applied' ? accent.green.border : effectiveStatus === 'rejected' ? border[1] : accent.violet.border}`,
        borderRadius: 8,
        margin: '8px 0',
        overflow: 'hidden',
        opacity: effectiveStatus === 'rejected' ? 0.5 : 1,
      }}
    >
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          cursor: 'pointer', background: surface.raised,
        }}
      >
        {expanded ? <ChevronDown size={12} color={fg[3]} /> : <ChevronRight size={12} color={fg[3]} />}
        <FileEdit size={13} color={accent.violet.fg} />
        <span style={{ fontSize: 12, color: fg[0], fontFamily: 'monospace', flex: 1 }}>{block.path}</span>
        {effectiveStatus === 'applied' && (
          <span style={{ fontSize: 10, color: accent.green.fg, display: 'flex', alignItems: 'center', gap: 3 }}>
            <Check size={11} /> Applied
          </span>
        )}
        {effectiveStatus === 'rejected' && <span style={{ fontSize: 10, color: fg[3] }}>Rejected</span>}
      </div>

      {expanded && (
        <>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 16, color: fg[3], fontSize: 11 }}>Loading current file…</div>
            ) : hunks.length === 0 ? (
              <div style={{ padding: 16, color: fg[3], fontSize: 11 }}>No changes (file already matches proposed content)</div>
            ) : (
              hunks.map((h) => (
                <HunkCard
                  key={h.id}
                  hunk={h}
                  accepted={accepted.has(h.id)}
                  onToggle={() => toggleHunk(h.id)}
                />
              ))
            )}
          </div>

          {effectiveStatus === 'pending' && (
            <div
              style={{
                display: 'flex', justifyContent: 'flex-end', gap: 8,
                padding: '8px 12px', borderTop: `1px solid ${border[1]}`,
              }}
            >
              <button
                type="button"
                onClick={reject}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'transparent', border: `1px solid ${border[0]}`, borderRadius: 5,
                  padding: '5px 12px', fontSize: 11, fontWeight: 600, color: fg[2], cursor: 'pointer',
                }}
              >
                <X size={11} /> Discard
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={accepted.size === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: accent.green.fg, border: 'none', borderRadius: 5,
                  padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#06150c', cursor: 'pointer',
                  opacity: accepted.size === 0 ? 0.4 : 1,
                }}
              >
                <Check size={11} /> Apply Selected ({accepted.size}/{hunks.length})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
