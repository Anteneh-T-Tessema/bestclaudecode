import { useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { FileEdit, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { accent, border, fg, surface } from '../../design'
import type { EditBlock } from '../../lib/editBlocks'

function languageFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', json: 'json', md: 'markdown', css: 'css', html: 'html',
  }
  return map[ext] ?? 'plaintext'
}

type Status = 'pending' | 'applied' | 'rejected'

interface EditProposalCardProps {
  block: EditBlock
  onApply?: () => void
  isGroupApplied?: boolean
}

export function EditProposalCard({ block, onApply, isGroupApplied }: EditProposalCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [original, setOriginal] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('pending')
  const [loading, setLoading] = useState(false)

  const projectPath = useSettingsStore((s) => s.projectPath)
  const openFile = useEditorStore((s) => s.openFile)
  const updateContent = useEditorStore((s) => s.updateContent)
  const tabs = useEditorStore((s) => s.tabs)

  const absPath = block.path.startsWith('/') ? block.path : `${projectPath}/${block.path}`

  const toggleExpand = async () => {
    if (!expanded && original === null) {
      setLoading(true)
      let currentContent = ''
      try {
        currentContent = await window.api.fs.readFile(absPath)
      } catch {
        currentContent = ''
      }
      setOriginal(currentContent)
      setLoading(false)
    }
    setExpanded((e) => !e)
  }

  const apply = async () => {
    try {
      await window.api.fs.writeFile(absPath, block.content)
      const openTab = tabs.find((t) => t.filePath === absPath)
      if (openTab) {
        updateContent(openTab.id, block.content)
      } else {
        openFile(absPath, block.content)
      }
      setStatus('applied')
      toast.success(`Applied edit to ${block.path}`)
      onApply?.()
    } catch (err) {
      toast.error(`Failed to apply edit: ${(err as Error).message}`)
    }
  }

  const reject = () => {
    setStatus('rejected')
  }

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
        onClick={toggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          background: surface.raised,
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
          <div style={{ height: 280 }}>
            {loading ? (
              <div style={{ padding: 16, color: fg[3], fontSize: 11 }}>Loading current file…</div>
            ) : (
              <DiffEditor
                original={original ?? ''}
                modified={block.content}
                language={languageFromPath(block.path)}
                theme="lakoora-dark"
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  fontSize: 11,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            )}
          </div>
          {effectiveStatus === 'pending' && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                padding: '8px 12px',
                borderTop: `1px solid ${border[1]}`,
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
                <X size={11} /> Reject
              </button>
              <button
                type="button"
                onClick={apply}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: accent.green.fg, border: 'none', borderRadius: 5,
                  padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#06150c', cursor: 'pointer',
                }}
              >
                <Check size={11} /> Apply
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
