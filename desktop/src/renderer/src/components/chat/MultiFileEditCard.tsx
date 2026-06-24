import { useState, useEffect, useCallback } from 'react'
import { FileEdit, Check, X, CheckCheck, XSquare } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { toast } from '../../store/useToastStore'
import { accent, border, fg, surface } from '../../design'
import type { EditBlock } from '../../lib/editBlocks'
import { diffLines, buildHunks, applyHunks, HunkCard, type Hunk } from '../../lib/hunkDiff'

type FileStatus = 'pending' | 'applied' | 'rejected'

function StatusDot({ status }: { status: FileStatus }) {
  const color =
    status === 'applied' ? accent.green.fg :
    status === 'rejected' ? fg[4] :
    accent.amber.fg
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: color, flexShrink: 0, display: 'inline-block',
    }} />
  )
}

export function MultiFileEditCard({ blocks }: { blocks: EditBlock[] }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [statuses, setStatuses] = useState<FileStatus[]>(() => blocks.map(() => 'pending'))
  const [originals, setOriginals] = useState<(string | null)[]>(() => blocks.map(() => null))
  const [applyingAll, setApplyingAll] = useState(false)
  // Per-file hunk state, computed lazily once a file's original content loads.
  const [hunksByFile, setHunksByFile] = useState<Record<number, Hunk[]>>({})
  const [acceptedByFile, setAcceptedByFile] = useState<Record<number, Set<number>>>({})

  const projectPath = useSettingsStore((s) => s.projectPath)
  const openFile = useEditorStore((s) => s.openFile)
  const updateContent = useEditorStore((s) => s.updateContent)
  const tabs = useEditorStore((s) => s.tabs)

  const absPath = (b: EditBlock) =>
    b.path.startsWith('/') ? b.path : `${projectPath}/${b.path}`

  // Load original content for the selected file on demand, then compute hunks.
  useEffect(() => {
    if (originals[selectedIdx] !== null) return
    void (async () => {
      let content = ''
      try { content = await window.api.fs.readFile(absPath(blocks[selectedIdx])) } catch {}
      setOriginals((prev) => { const next = [...prev]; next[selectedIdx] = content; return next })
      const hunks = buildHunks(diffLines(content, blocks[selectedIdx].content))
      setHunksByFile((prev) => ({ ...prev, [selectedIdx]: hunks }))
      setAcceptedByFile((prev) => ({ ...prev, [selectedIdx]: new Set(hunks.map((h) => h.id)) }))
    })()
  }, [selectedIdx, blocks])

  const toggleHunk = useCallback((idx: number, hunkId: number) => {
    setAcceptedByFile((prev) => {
      const next = new Set(prev[idx] ?? [])
      if (next.has(hunkId)) next.delete(hunkId)
      else next.add(hunkId)
      return { ...prev, [idx]: next }
    })
  }, [])

  const acceptAllHunks = useCallback((idx: number) => {
    setAcceptedByFile((prev) => ({ ...prev, [idx]: new Set((hunksByFile[idx] ?? []).map((h) => h.id)) }))
  }, [hunksByFile])

  const rejectAllHunks = useCallback((idx: number) => {
    setAcceptedByFile((prev) => ({ ...prev, [idx]: new Set() }))
  }, [])

  // Resolves the content to write for a file: full block content unless the
  // user has partially accepted hunks for it.
  const resolvedContent = (idx: number): string => {
    const hunks = hunksByFile[idx]
    const accepted = acceptedByFile[idx]
    if (!hunks || !accepted || accepted.size === hunks.length) return blocks[idx].content
    return applyHunks(originals[idx] ?? '', hunks, accepted)
  }

  const applyFile = async (idx: number) => {
    const path = absPath(blocks[idx])
    const content = resolvedContent(idx)
    try {
      await window.api.fs.writeFile(path, content)
      const tab = tabs.find((t) => t.filePath === path)
      if (tab) updateContent(tab.id, content)
      else openFile(path, content)
      setStatuses((prev) => { const next = [...prev]; next[idx] = 'applied'; return next })
      const hunks = hunksByFile[idx]
      const accepted = acceptedByFile[idx]
      toast.success(
        hunks && accepted && accepted.size < hunks.length
          ? `Applied ${accepted.size}/${hunks.length} hunks in ${blocks[idx].path}`
          : `Applied ${blocks[idx].path}`
      )
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    }
  }

  const rejectFile = (idx: number) => {
    setStatuses((prev) => { const next = [...prev]; next[idx] = 'rejected'; return next })
  }

  const applyAll = async () => {
    if (applyingAll) return
    setApplyingAll(true)
    const paths = blocks.map(absPath)
    const orig: string[] = await Promise.all(
      paths.map(async (p) => { try { return await window.api.fs.readFile(p) } catch { return '' } })
    )
    const applied: number[] = []
    let failed = false
    for (let i = 0; i < blocks.length; i++) {
      if (statuses[i] === 'rejected') continue
      try {
        const content = resolvedContent(i)
        await window.api.fs.writeFile(paths[i], content)
        const tab = tabs.find((t) => t.filePath === paths[i])
        if (tab) updateContent(tab.id, content)
        else openFile(paths[i], content)
        applied.push(i)
      } catch (err) {
        toast.error(`Apply failed on ${blocks[i].path}: ${(err as Error).message}`)
        failed = true
        break
      }
    }
    if (failed) {
      // Roll back all successful writes
      for (const i of [...applied].reverse()) {
        try {
          await window.api.fs.writeFile(paths[i], orig[i])
          const tab = tabs.find((t) => t.filePath === paths[i])
          if (tab) updateContent(tab.id, orig[i])
        } catch {}
      }
      toast.error('Rolled back — no files were changed')
    } else {
      setStatuses((prev) => prev.map((s) => (s === 'pending' ? 'applied' : s)))
      toast.success(`${applied.length} file${applied.length === 1 ? '' : 's'} updated`)
    }
    setApplyingAll(false)
  }

  const rejectAll = () => setStatuses(blocks.map(() => 'rejected'))

  const pendingCount = statuses.filter((s) => s === 'pending').length
  const allDone = pendingCount === 0
  const selectedBlock = blocks[selectedIdx]
  const selectedStatus = statuses[selectedIdx]
  const selectedHunks = hunksByFile[selectedIdx]
  const selectedAccepted = acceptedByFile[selectedIdx]

  return (
    <div
      style={{
        border: `1px solid ${allDone ? border[1] : accent.violet.border}`,
        borderRadius: 8,
        margin: '8px 0',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', background: surface.raised,
          borderBottom: `1px solid ${border[1]}`,
        }}
      >
        <FileEdit size={13} color={accent.violet.fg} />
        <span style={{ fontSize: 12, color: fg[1], flex: 1 }}>
          {blocks.length} files · {statuses.filter((s) => s === 'applied').length} applied · {pendingCount} pending
        </span>
        {!allDone && (
          <>
            <button
              type="button"
              onClick={rejectAll}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'transparent', border: `1px solid ${border[0]}`,
                borderRadius: 5, padding: '4px 10px', fontSize: 11,
                color: fg[2], cursor: 'pointer',
              }}
            >
              <XSquare size={11} /> Reject All
            </button>
            <button
              type="button"
              onClick={applyAll}
              disabled={applyingAll}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: applyingAll ? surface.raised : accent.green.fg,
                border: 'none', borderRadius: 5, padding: '4px 10px',
                fontSize: 11, fontWeight: 700,
                color: applyingAll ? fg[2] : '#06150c',
                cursor: applyingAll ? 'not-allowed' : 'pointer',
              }}
            >
              <CheckCheck size={11} />
              {applyingAll ? 'Applying…' : `Accept All (${pendingCount})`}
            </button>
          </>
        )}
      </div>

      {/* Body */}
      <div style={{ display: 'flex', height: 380 }}>
        {/* File list sidebar */}
        <div
          style={{
            width: 200, flexShrink: 0,
            borderRight: `1px solid ${border[1]}`,
            overflowY: 'auto',
            background: surface.void,
          }}
        >
          {blocks.map((block, i) => (
            <div
              key={i}
              onClick={() => setSelectedIdx(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 10px', cursor: 'pointer',
                background: i === selectedIdx ? surface.raised : 'transparent',
                borderLeft: i === selectedIdx
                  ? `2px solid ${accent.violet.fg}`
                  : '2px solid transparent',
                opacity: statuses[i] === 'rejected' ? 0.45 : 1,
              }}
            >
              <StatusDot status={statuses[i]} />
              <span
                style={{
                  fontSize: 11,
                  color: i === selectedIdx ? fg[0] : fg[2],
                  fontFamily: 'monospace',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  flex: 1,
                }}
                title={block.path}
              >
                {block.path.split('/').pop()}
              </span>
              {statuses[i] === 'applied' && <Check size={10} color={accent.green.fg} />}
              {statuses[i] === 'rejected' && <X size={10} color={fg[4]} />}
            </div>
          ))}
        </div>

        {/* Diff panel — per-hunk accept/reject */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {originals[selectedIdx] === null || !selectedHunks ? (
            <div style={{ flex: 1, padding: 16, color: fg[3], fontSize: 11 }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderBottom: `1px solid ${border[2]}`, background: surface.base, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: fg[3] }}>
                  {selectedHunks.length === 0 ? 'No changes' : `${selectedAccepted?.size ?? 0}/${selectedHunks.length} hunk${selectedHunks.length !== 1 ? 's' : ''} accepted`}
                </span>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => acceptAllHunks(selectedIdx)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: accent.green.fg, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <CheckCheck size={10} /> Accept all
                </button>
                <button type="button" onClick={() => rejectAllHunks(selectedIdx)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: fg[3], display: 'flex', alignItems: 'center', gap: 3 }}>
                  <XSquare size={10} /> Reject all
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', background: surface.surface }}>
                {selectedHunks.length === 0 ? (
                  <div style={{ padding: '12px 14px', fontSize: 11, color: fg[3] }}>No differences found.</div>
                ) : (
                  selectedHunks.map((h) => (
                    <HunkCard
                      key={h.id}
                      hunk={h}
                      accepted={selectedAccepted?.has(h.id) ?? true}
                      onToggle={() => toggleHunk(selectedIdx, h.id)}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {/* Per-file action bar */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 12px', borderTop: `1px solid ${border[1]}`,
              background: surface.raised, flexShrink: 0,
            }}
          >
            <span
              style={{ fontSize: 10, color: fg[3], fontFamily: 'monospace',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}
              title={selectedBlock.path}
            >
              {selectedBlock.path}
            </span>
            {selectedStatus === 'pending' ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => rejectFile(selectedIdx)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'transparent', border: `1px solid ${border[0]}`,
                    borderRadius: 5, padding: '4px 10px',
                    fontSize: 11, fontWeight: 600, color: fg[2], cursor: 'pointer',
                  }}
                >
                  <X size={11} /> Reject
                </button>
                <button
                  type="button"
                  onClick={() => applyFile(selectedIdx)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: accent.green.fg, border: 'none', borderRadius: 5,
                    padding: '4px 10px', fontSize: 11, fontWeight: 700,
                    color: '#06150c', cursor: 'pointer',
                  }}
                >
                  <Check size={11} />
                  {selectedHunks && selectedAccepted && selectedAccepted.size < selectedHunks.length
                    ? `Apply ${selectedAccepted.size} hunk${selectedAccepted.size !== 1 ? 's' : ''}`
                    : 'Apply'}
                </button>
              </div>
            ) : (
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: selectedStatus === 'applied' ? accent.green.fg : fg[3],
              }}>
                {selectedStatus === 'applied' ? '✓ Applied' : 'Rejected'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
