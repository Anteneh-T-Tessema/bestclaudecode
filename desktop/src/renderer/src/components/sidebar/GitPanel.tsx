import { useState, useEffect, useCallback, useRef } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { GitBranch, RefreshCw, Plus, GitCommit, Clock, CheckCircle, Minus, AlertCircle, X, ArrowUp, ArrowDown, ChevronRight, FileText, Check, Sparkles, Bookmark, RotateCcw, Trash2, ChevronDown } from 'lucide-react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useAppStore } from '../../store/useAppStore'
import { useChatStore } from '../../store/useChatStore'
import { toast } from '../../store/useToastStore'
import { EmptyState } from '../EmptyState'
import { PanelHeader, IconButton, accent, border, fg, surface } from '../../design'

function languageFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', json: 'json', md: 'markdown', css: 'css', html: 'html',
  }
  return map[ext] ?? 'plaintext'
}

interface FileEntry { status: string; path: string; staged: boolean }
interface LogEntry { hash: string; message: string }
interface CommitFile { status: string; path: string; oldPath?: string }

function BranchDropdown({
  projectPath,
  currentBranch,
  anchorRef,
  onClose,
  onSwitch,
}: {
  projectPath: string
  currentBranch: string
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  onSwitch: () => void
}) {
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const rect = anchorRef.current?.getBoundingClientRect()
  const top = rect ? rect.bottom + 4 : 40
  const left = rect ? rect.left : 0

  useEffect(() => {
    window.api.git.listBranches(projectPath)
      .then((r) => {
        const res = r as { branches: string[]; current: string | null }
        setBranches(res.branches)
      })
      .catch(() => setBranches([]))
      .finally(() => setLoading(false))
  }, [projectPath])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 10)
  }, [creating])

  const checkout = async (branch: string) => {
    if (branch === currentBranch) return onClose()
    setSwitching(branch)
    try {
      const result = await window.api.git.checkoutBranch(projectPath, branch)
      const r = result as { success: boolean; error?: string }
      if (r.success) {
        toast.success(`Switched to ${branch}`)
        onSwitch()
        onClose()
      } else {
        toast.error(`Checkout failed: ${r.error ?? 'unknown'}`)
      }
    } finally {
      setSwitching(null)
    }
  }

  const createBranch = async () => {
    const name = newName.trim()
    if (!name) return
    setSwitching(name)
    try {
      const result = await window.api.git.createBranch(projectPath, name)
      const r = result as { success: boolean; error?: string }
      if (r.success) {
        toast.success(`Created and switched to ${name}`)
        onSwitch()
        onClose()
      } else {
        toast.error(`Create failed: ${r.error ?? 'unknown'}`)
      }
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 9000,
        width: 220,
        background: surface.overlay,
        border: `1px solid ${border[0]}`,
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '5px 10px 3px', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: fg[4] }}>
        Switch Branch
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {loading && <div style={{ padding: '8px 12px', fontSize: 11, color: fg[3] }}>Loading…</div>}
        {branches.map((b) => {
          const isCurrent = b === currentBranch
          const isSwitching = switching === b
          return (
            <div
              key={b}
              onClick={() => void checkout(b)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                cursor: isCurrent ? 'default' : 'pointer',
                background: isCurrent ? accent.green.subtle : 'transparent',
              }}
            >
              {isCurrent
                ? <Check style={{ width: 11, height: 11, color: accent.green.fg, flexShrink: 0 }} />
                : <GitBranch style={{ width: 11, height: 11, color: isSwitching ? accent.amber.fg : fg[4], flexShrink: 0 }} />}
              <span style={{ fontSize: 12, color: isCurrent ? accent.green.fg : fg[1], fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b}
              </span>
              {isSwitching && <RefreshCw style={{ width: 10, height: 10, color: accent.amber.fg, flexShrink: 0 }} className="agent-pulse" />}
            </div>
          )
        })}
      </div>
      <div style={{ borderTop: `1px solid ${border[1]}`, padding: '6px 10px' }}>
        {creating ? (
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createBranch()
              if (e.key === 'Escape') { setCreating(false); setNewName('') }
            }}
            placeholder="new-branch-name"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: surface.raised,
              border: `1px solid ${border[0]}`,
              borderRadius: 3,
              color: fg[0],
              fontSize: 11,
              padding: '4px 7px',
              outline: 'none',
              fontFamily: 'monospace',
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: fg[2],
              fontSize: 11,
              padding: 0,
            }}
          >
            <Plus style={{ width: 11, height: 11 }} />
            New Branch…
          </button>
        )}
      </div>
    </div>
  )
}

function statusLabel(s: string): { label: string; color: string } {
  if (s === 'M' || s === 'MM') return { label: 'M', color: accent.amber.fg }
  if (s === '??' || s === 'A') return { label: '+', color: accent.green.fg }
  if (s === 'D') return { label: '-', color: accent.red.fg }
  if (s === 'R') return { label: 'R', color: accent.cyan.fg }
  return { label: s.trim(), color: fg[2] }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '5px 12px 3px',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: fg[3],
      }}
    >
      {children}
    </div>
  )
}

function FileRow({
  label,
  color,
  name,
  selected,
  onClick,
  onDiscard,
}: {
  label: string
  color: string
  name: string
  selected: boolean
  onClick: () => void
  onDiscard?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const bg = selected ? accent.amber.subtle : hovered ? surface.raised : 'transparent'

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 12px',
        cursor: 'pointer',
        background: bg,
      }}
    >
      {selected ? (
        <CheckCircle style={{ width: 10, height: 10, color: accent.amber.fg, flexShrink: 0 }} />
      ) : (
        <Minus style={{ width: 10, height: 10, color: fg[4], flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 10, color, flexShrink: 0, fontFamily: 'monospace', fontWeight: 700 }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          color: fg[1],
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {onDiscard && hovered && (
        <button
          type="button"
          title="Discard changes"
          onClick={(e) => { e.stopPropagation(); onDiscard() }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: 3, border: 'none', flexShrink: 0,
            background: 'transparent', color: accent.red.fg, cursor: 'pointer', padding: 0,
          }}
        >
          <RotateCcw style={{ width: 9, height: 9 }} />
        </button>
      )}
    </div>
  )
}

export function GitPanel() {
  const projectPath = useSettingsStore((s) => s.projectPath)
  const setActiveActivity = useAppStore((s) => s.setActiveActivity)
  const [branch, setBranch] = useState<string | null>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [generatingMsg, setGeneratingMsg] = useState(false)
  const activeModel = useChatStore((s) => s.activeModel)
  const [loading, setLoading] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [diffFile, setDiffFile] = useState<FileEntry | null>(null)
  const [diffData, setDiffData] = useState<{ original: string; modified: string } | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffTitle, setDiffTitle] = useState<string | null>(null)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFileMap, setCommitFileMap] = useState<Record<string, CommitFile[]>>({})
  const [commitFilesLoading, setCommitFilesLoading] = useState<string | null>(null)
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)
  const branchBadgeRef = useRef<HTMLSpanElement>(null)

  // Gap 89 — undo last commit
  const [undoing, setUndoing] = useState(false)

  // Gap 90 — merge branch
  const [mergeBranch, setMergeBranch] = useState('')
  const [merging, setMerging] = useState(false)
  const [allBranches, setAllBranches] = useState<string[]>([])

  // Checkpoints (git stash)
  interface Checkpoint { ref: string; name: string; age: string }
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [checkpointsOpen, setCheckpointsOpen] = useState(true)
  const [cpSaving, setCpSaving] = useState(false)
  const [cpNameDraft, setCpNameDraft] = useState('')
  const [cpInputOpen, setCpInputOpen] = useState(false)
  const [cpRestoring, setCpRestoring] = useState<string | null>(null)
  const cpInputRef = useRef<HTMLInputElement>(null)

  const loadCheckpoints = useCallback(async () => {
    if (!projectPath) return
    try {
      const list = await window.api.git.stashList(projectPath)
      setCheckpoints(list)
    } catch {
      setCheckpoints([])
    }
  }, [projectPath])

  const saveCheckpoint = useCallback(async () => {
    const name = cpNameDraft.trim() || `checkpoint ${new Date().toLocaleTimeString()}`
    if (!projectPath) return
    setCpSaving(true)
    try {
      const result = await window.api.git.stashCreate(projectPath, name)
      if (result.success) {
        toast.success(`Checkpoint "${name}" saved`)
        setCpInputOpen(false)
        setCpNameDraft('')
        loadCheckpoints()
        refresh()
      } else {
        toast.error(`Checkpoint failed: ${result.error ?? 'unknown'}`)
      }
    } finally {
      setCpSaving(false)
    }
  }, [projectPath, cpNameDraft, loadCheckpoints])

  const restoreCheckpoint = useCallback(async (ref: string, name: string) => {
    if (!projectPath) return
    setCpRestoring(ref)
    try {
      const result = await window.api.git.stashApply(projectPath, ref)
      if (result.success) {
        toast.success(`Checkpoint "${name}" restored`)
        loadCheckpoints()
        refresh()
      } else {
        toast.error(`Restore failed: ${result.error ?? 'unknown'}`)
      }
    } finally {
      setCpRestoring(null)
    }
  }, [projectPath, loadCheckpoints])

  const dropCheckpoint = useCallback(async (ref: string, name: string) => {
    if (!projectPath) return
    try {
      const result = await window.api.git.stashDrop(projectPath, ref)
      if (result.success) {
        toast.success(`Checkpoint "${name}" deleted`)
        loadCheckpoints()
      } else {
        toast.error(`Delete failed: ${result.error ?? 'unknown'}`)
      }
    } catch {}
  }, [projectPath, loadCheckpoints])

  const refresh = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const [b, rawFiles, rawLog, ab] = await Promise.all([
        window.api.git.branch(projectPath),
        window.api.git.statusFiles(projectPath),
        window.api.git.log(projectPath),
        window.api.git.aheadBehind(projectPath),
      ])
      setBranch(b)
      const parsed: FileEntry[] = (rawFiles as Array<{ status: string; path: string }>).map((f) => ({
        status: f.status,
        path: f.path,
        staged: /^[MADRC]/.test(f.status) && !/^\s/.test(f.status),
      }))
      setFiles(parsed)
      setLog(rawLog as LogEntry[])
      const { ahead: a, behind: be } = ab as { ahead: number; behind: number }
      setAhead(a)
      setBehind(be)
    } catch {
      // not a git repo
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  const handlePush = useCallback(async () => {
    if (!projectPath) return
    setPushing(true)
    try {
      const result = await window.api.git.push(projectPath, { setUpstream: ahead > 0 && behind === 0 })
      if ((result as { success: boolean; error?: string }).success) {
        toast.success('Pushed successfully')
        refresh()
      } else {
        toast.error(`Push failed: ${(result as { error?: string }).error ?? 'unknown error'}`)
      }
    } catch (e) {
      toast.error(`Push failed: ${(e as Error).message}`)
    } finally {
      setPushing(false)
    }
  }, [projectPath, ahead, behind, refresh])

  const handlePull = useCallback(async () => {
    if (!projectPath) return
    setPulling(true)
    try {
      const result = await window.api.git.pull(projectPath)
      if ((result as { success: boolean; error?: string }).success) {
        toast.success('Pulled successfully')
        refresh()
      } else {
        toast.error(`Pull failed: ${(result as { error?: string }).error ?? 'unknown error'}`)
      }
    } catch (e) {
      toast.error(`Pull failed: ${(e as Error).message}`)
    } finally {
      setPulling(false)
    }
  }, [projectPath, refresh])

  useEffect(() => {
    refresh()
    loadCheckpoints()
    if (projectPath) {
      window.api.git.listBranches(projectPath)
        .then((r) => setAllBranches((r as { branches: string[] }).branches ?? []))
        .catch(() => {})
    }
  }, [refresh, loadCheckpoints, projectPath])

  useEffect(() => {
    if (cpInputOpen) setTimeout(() => cpInputRef.current?.focus(), 30)
  }, [cpInputOpen])

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const stageSelected = async () => {
    if (selected.size === 0 || !projectPath) return
    const paths = Array.from(selected)
    const result = await window.api.git.add(projectPath, paths)
    if (result.success) {
      toast.success(`Staged ${paths.length} file${paths.length > 1 ? 's' : ''}`)
      setSelected(new Set())
      refresh()
    } else {
      toast.error(`Stage failed: ${result.error}`)
    }
  }

  const stageAll = async () => {
    if (!projectPath) return
    const result = await window.api.git.add(projectPath, ['.'])
    if (result.success) {
      toast.success('Staged all changes')
      setSelected(new Set())
      refresh()
    } else {
      toast.error(`Stage failed: ${result.error}`)
    }
  }

  // Gap 85 — discard unstaged changes for a single file
  const discardFile = async (filePath: string) => {
    if (!projectPath) return
    const result = await window.api.git.discardFile(projectPath, filePath)
    if (result.success) {
      toast.success(`Discarded changes in ${filePath.split('/').pop()}`)
      setSelected((prev) => { const next = new Set(prev); next.delete(filePath); return next })
      refresh()
    } else {
      toast.error(`Discard failed: ${result.error}`)
    }
  }

  // Gap 89 — soft reset HEAD~1
  const undoLastCommit = async () => {
    if (!projectPath) return
    setUndoing(true)
    try {
      const result = await window.api.git.undoLastCommit(projectPath)
      if (result.success) {
        toast.success('Last commit undone (changes re-staged)')
        refresh()
      } else {
        toast.error(`Undo failed: ${result.error}`)
      }
    } finally {
      setUndoing(false)
    }
  }

  // Gap 90 — merge branch
  const handleMerge = async () => {
    if (!projectPath || !mergeBranch) return
    setMerging(true)
    try {
      const result = await window.api.git.merge(projectPath, mergeBranch)
      if (result.success) {
        toast.success(`Merged ${mergeBranch}`)
        setMergeBranch('')
        refresh()
      } else {
        toast.error(`Merge failed: ${result.error}`)
      }
    } finally {
      setMerging(false)
    }
  }

  const handleCommit = async () => {
    if (!message.trim() || !projectPath) return
    setCommitting(true)
    const result = await window.api.git.commit(projectPath, message.trim())
    setCommitting(false)
    if (result.success) {
      toast.success('Committed successfully')
      setMessage('')
      setSelected(new Set())
      refresh()
    } else {
      toast.error(`Commit failed: ${result.error}`)
    }
  }

  const generateCommitMsg = async () => {
    if (!projectPath || generatingMsg) return
    setGeneratingMsg(true)
    try {
      const diff = await window.api.git.stagedDiff(projectPath)
      if (!diff.trim()) {
        toast.error('No staged changes — stage files first')
        return
      }
      const streamId = await window.api.ai.streamChat({
        messages: [{
          role: 'user',
          content: `Write a concise git commit message for these staged changes:\n\n${diff.slice(0, 8000)}`,
        }],
        model: activeModel,
        systemPrompt: 'You are a git commit message expert. Return ONLY the commit message — subject line ≤72 chars in imperative mood, optional blank line + body. No extra commentary.',
      })
      let msg = ''
      await new Promise<void>((resolve, reject) => {
        const unChunk = window.api.ai.onChunk(streamId, (d) => { msg += d })
        const unDone = window.api.ai.onDone(streamId, () => { unChunk(); unDone(); resolve() })
        const unErr = window.api.ai.onError(streamId, (e) => { unChunk(); unDone(); unErr(); reject(new Error(e)) })
      })
      setMessage(msg.trim())
    } catch (err) {
      toast.error(`Failed to generate commit message: ${(err as Error).message}`)
    } finally {
      setGeneratingMsg(false)
    }
  }

  const openDiff = useCallback(async (entry: FileEntry) => {
    if (!projectPath) return
    setDiffFile(entry)
    setDiffTitle(null)
    setDiffData(null)
    setDiffLoading(true)
    try {
      const relPath = entry.path.startsWith('/') ? entry.path.slice(projectPath.length + 1) : entry.path
      const absPath = entry.path.startsWith('/') ? entry.path : `${projectPath}/${entry.path}`
      const [original, modified] = await Promise.all([
        window.api.git.show(projectPath, relPath).catch(() => ''),
        window.api.fs.readFile(absPath).catch(() => ''),
      ])
      setDiffData({ original, modified })
    } finally {
      setDiffLoading(false)
    }
  }, [projectPath])

  const toggleCommit = useCallback(async (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null)
      return
    }
    setExpandedCommit(hash)
    if (commitFileMap[hash]) return
    if (!projectPath) return
    setCommitFilesLoading(hash)
    try {
      const files = await window.api.git.commitFiles(projectPath, hash)
      setCommitFileMap((m) => ({ ...m, [hash]: files as CommitFile[] }))
    } finally {
      setCommitFilesLoading(null)
    }
  }, [expandedCommit, commitFileMap, projectPath])

  const openCommitDiff = useCallback(async (hash: string, file: CommitFile) => {
    if (!projectPath) return
    const relPath = file.oldPath ?? file.path
    const pseudoEntry: FileEntry = { status: file.status, path: file.path, staged: true }
    setDiffFile(pseudoEntry)
    setDiffTitle(`${hash.slice(0, 7)} · ${file.path.split('/').pop()}`)
    setDiffData(null)
    setDiffLoading(true)
    try {
      const [original, modified] = await Promise.all([
        window.api.git.fileAtRevision(projectPath, `${hash}^`, relPath).catch(() => ''),
        window.api.git.fileAtRevision(projectPath, hash, file.path).catch(() => ''),
      ])
      setDiffData({ original, modified })
    } finally {
      setDiffLoading(false)
    }
  }, [projectPath])

  const changedFiles = files.filter((f) => !f.staged)
  const stagedFiles = files.filter((f) => f.staged)

  const headerActions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {branch && (
        <>
          <span
            ref={branchBadgeRef}
            onClick={() => setBranchDropdownOpen((o) => !o)}
            title="Switch branch"
            style={{
              fontSize: 10,
              color: accent.green.fg,
              fontFamily: 'monospace',
              background: branchDropdownOpen ? accent.green.border : accent.green.subtle,
              border: `1px solid ${accent.green.border}`,
              padding: '1px 6px',
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {branch}
            {behind > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 1, color: accent.cyan.fg }}>
                <ArrowDown style={{ width: 9, height: 9 }} />
                {behind}
              </span>
            )}
            {ahead > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 1, color: accent.amber.fg }}>
                <ArrowUp style={{ width: 9, height: 9 }} />
                {ahead}
              </span>
            )}
          </span>
          {branchDropdownOpen && projectPath && (
            <BranchDropdown
              projectPath={projectPath}
              currentBranch={branch}
              anchorRef={branchBadgeRef}
              onClose={() => setBranchDropdownOpen(false)}
              onSwitch={refresh}
            />
          )}
        </>
      )}
      <IconButton
        size={22}
        onClick={handlePull}
        disabled={pulling || pushing}
        title={behind > 0 ? `Pull (${behind} commit${behind !== 1 ? 's' : ''} behind)` : 'Pull'}
      >
        <ArrowDown style={{ width: 11, height: 11, color: pulling ? accent.cyan.fg : undefined }} className={pulling ? 'agent-pulse' : ''} />
      </IconButton>
      <IconButton
        size={22}
        onClick={handlePush}
        disabled={pushing || pulling}
        title={ahead > 0 ? `Push (${ahead} commit${ahead !== 1 ? 's' : ''} ahead)` : 'Push'}
      >
        <ArrowUp style={{ width: 11, height: 11, color: pushing ? accent.amber.fg : undefined }} className={pushing ? 'agent-pulse' : ''} />
      </IconButton>
      <IconButton size={22} onClick={refresh} disabled={loading} title="Refresh">
        <RefreshCw style={{ width: 11, height: 11 }} className={loading ? 'agent-pulse' : ''} />
      </IconButton>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PanelHeader
        icon={<GitBranch style={{ width: 13, height: 13, color: accent.green.fg }} />}
        label="Source Control"
        actions={headerActions}
      />

      {!projectPath ? (
        <EmptyState
          icon={<GitBranch size={20} />}
          title="No project open"
          description="Open a project folder to view its git status, stage changes, and commit."
          action={{ label: 'Open project', onClick: () => setActiveActivity('files') }}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Commit message (⌘↵ to commit)"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCommit()
              }}
              rows={3}
              style={{
                width: '100%',
                resize: 'none',
                boxSizing: 'border-box',
                background: surface.raised,
                border: `1px solid ${border[0]}`,
                borderRadius: 3,
                color: fg[0],
                fontSize: 11,
                padding: '6px 8px',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
            />
            <button
              type="button"
              onClick={generateCommitMsg}
              disabled={generatingMsg}
              title="Generate commit message from staged diff"
              style={{
                position: 'absolute',
                top: 5,
                right: 6,
                background: 'none',
                border: 'none',
                cursor: generatingMsg ? 'not-allowed' : 'pointer',
                color: generatingMsg ? fg[4] : accent.violet.fg,
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Sparkles size={12} />
            </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button
                type="button"
                onClick={stageAll}
                title="Stage all changes"
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '5px 0',
                  background: surface.overlay,
                  border: `1px solid ${border[0]}`,
                  borderRadius: 3,
                  color: fg[2],
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                }}
              >
                <Plus style={{ width: 10, height: 10 }} /> Stage All
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={!message.trim() || committing}
                style={{
                  flex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '5px 0',
                  background: message.trim() && !committing ? accent.green.subtle : surface.raised,
                  border: `1px solid ${message.trim() && !committing ? accent.green.border : border[1]}`,
                  borderRadius: 3,
                  color: message.trim() && !committing ? accent.green.fg : fg[3],
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  cursor: message.trim() ? 'pointer' : 'default',
                }}
              >
                <GitCommit style={{ width: 10, height: 10 }} />
                {committing ? 'Committing…' : 'Commit'}
              </button>
            </div>

            {selected.size > 0 && (
              <button
                type="button"
                onClick={stageSelected}
                style={{
                  width: '100%',
                  marginTop: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '4px 0',
                  background: 'transparent',
                  border: `1px dashed ${accent.amber.dim}`,
                  borderRadius: 3,
                  color: accent.amber.fg,
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                <Plus style={{ width: 10, height: 10 }} />
                Stage {selected.size} selected
              </button>
            )}
          </div>

          {stagedFiles.length > 0 && (
            <div style={{ flexShrink: 0 }}>
              <SectionLabel>Staged ({stagedFiles.length})</SectionLabel>
              {stagedFiles.map((f) => {
                const { label, color } = statusLabel(f.status)
                const isActive = diffFile?.path === f.path
                return (
                  <div
                    key={f.path}
                    onClick={() => openDiff(f)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px',
                      cursor: 'pointer',
                      background: isActive ? accent.green.subtle : 'transparent',
                      borderLeft: isActive ? `2px solid ${accent.green.fg}` : '2px solid transparent',
                    }}
                  >
                    <CheckCircle style={{ width: 10, height: 10, color: accent.green.fg, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color, flexShrink: 0, fontFamily: 'monospace', fontWeight: 700 }}>
                      {label}
                    </span>
                    <span style={{ fontSize: 11, color: fg[1], flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.path.split('/').pop()}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {changedFiles.length > 0 && (
            <div style={{ flexShrink: 0 }}>
              <SectionLabel>Changes ({changedFiles.length})</SectionLabel>
              {changedFiles.map((f) => {
                const { label, color } = statusLabel(f.status)
                const isSel = selected.has(f.path)
                return (
                  <FileRow
                    key={f.path}
                    label={label}
                    color={color}
                    name={f.path.split('/').pop() ?? f.path}
                    selected={isSel}
                    onClick={() => { toggleSelect(f.path); void openDiff(f) }}
                    onDiscard={() => void discardFile(f.path)}
                  />
                )
              })}
            </div>
          )}

          {files.length === 0 && !loading && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: 24,
              }}
            >
              <CheckCircle style={{ width: 24, height: 24, color: border[0] }} />
              <p style={{ fontSize: 11, color: fg[3], textAlign: 'center', lineHeight: 1.5, margin: 0 }}>
                Working tree is clean
              </p>
            </div>
          )}

          {/* ── Checkpoints ───────────────────────────────────────────── */}
          <div style={{ borderBottom: `1px solid ${border[1]}`, flexShrink: 0 }}>
            {/* Header row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '5px 12px 3px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => setCheckpointsOpen((o) => !o)}
            >
              <Bookmark style={{ width: 10, height: 10, color: accent.violet.fg, flexShrink: 0, marginRight: 5 }} />
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: fg[3], flex: 1 }}>
                Checkpoints {checkpoints.length > 0 ? `(${checkpoints.length})` : ''}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setCpInputOpen((o) => !o) }}
                title="Save checkpoint"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent.violet.fg, padding: 2, display: 'flex', alignItems: 'center', borderRadius: 3 }}
              >
                <Plus style={{ width: 11, height: 11 }} />
              </button>
              <ChevronDown style={{
                width: 10, height: 10, color: fg[4], marginLeft: 2,
                transform: checkpointsOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.12s',
              }} />
            </div>

            {checkpointsOpen && (
              <>
                {/* Inline name input */}
                {cpInputOpen && (
                  <div style={{ padding: '4px 10px 6px' }}>
                    <input
                      ref={cpInputRef}
                      type="text"
                      value={cpNameDraft}
                      onChange={(e) => setCpNameDraft(e.target.value)}
                      placeholder="Checkpoint name…"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void saveCheckpoint() }
                        if (e.key === 'Escape') { setCpInputOpen(false); setCpNameDraft('') }
                      }}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        background: surface.raised,
                        border: `1px solid ${accent.violet.fg}`,
                        borderRadius: 4,
                        color: fg[0],
                        fontSize: 11,
                        padding: '4px 8px',
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
                      <button
                        type="button"
                        onClick={() => void saveCheckpoint()}
                        disabled={cpSaving}
                        style={{
                          flex: 1,
                          padding: '3px 0',
                          background: accent.violet.subtle,
                          border: `1px solid ${accent.violet.border}`,
                          borderRadius: 3,
                          color: accent.violet.fg,
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: cpSaving ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {cpSaving ? 'Saving…' : 'Save Checkpoint'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setCpInputOpen(false); setCpNameDraft('') }}
                        style={{
                          padding: '3px 8px',
                          background: 'none',
                          border: `1px solid ${border[1]}`,
                          borderRadius: 3,
                          color: fg[3],
                          fontSize: 10,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {checkpoints.length === 0 && !cpInputOpen && (
                  <div style={{ padding: '4px 12px 8px', fontSize: 10, color: fg[4] }}>
                    No checkpoints — click + to save the current working state.
                  </div>
                )}

                {checkpoints.map((cp) => (
                  <div
                    key={cp.ref}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderTop: `1px solid ${border[2]}`,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = surface.raised }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                  >
                    <Bookmark style={{ width: 10, height: 10, color: accent.violet.dim, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: fg[1], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cp.name}
                      </div>
                      <div style={{ fontSize: 9, color: fg[4], marginTop: 1 }}>{cp.age} · {cp.ref}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreCheckpoint(cp.ref, cp.name)}
                      disabled={cpRestoring === cp.ref}
                      title="Restore (apply stash)"
                      style={{
                        flexShrink: 0,
                        background: 'none',
                        border: `1px solid ${accent.green.border}`,
                        borderRadius: 3,
                        color: cpRestoring === cp.ref ? fg[4] : accent.green.fg,
                        cursor: 'pointer',
                        padding: '2px 5px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <RotateCcw style={{ width: 10, height: 10 }} className={cpRestoring === cp.ref ? 'agent-pulse' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void dropCheckpoint(cp.ref, cp.name)}
                      title="Delete checkpoint"
                      style={{
                        flexShrink: 0,
                        background: 'none',
                        border: 'none',
                        color: fg[4],
                        cursor: 'pointer',
                        padding: '2px 3px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Gap 90 — Merge branch */}
          {allBranches.filter((b) => b !== branch).length > 0 && (
            <div style={{ flexShrink: 0, padding: '6px 10px', borderBottom: `1px solid ${border[1]}` }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: fg[3], marginBottom: 5 }}>
                Merge Branch
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                <select
                  value={mergeBranch}
                  onChange={(e) => setMergeBranch(e.target.value)}
                  title="Branch to merge into the current branch"
                  style={{
                    flex: 1, background: surface.raised, border: `1px solid ${border[0]}`,
                    borderRadius: 4, padding: '4px 6px', fontSize: 10.5, color: fg[0], outline: 'none',
                  }}
                >
                  <option value="">Select branch…</option>
                  {allBranches.filter((b) => b !== branch).map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleMerge()}
                  disabled={!mergeBranch || merging}
                  style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 4,
                    border: `1px solid ${mergeBranch ? accent.cyan.border : border[0]}`,
                    background: mergeBranch ? accent.cyan.subtle : surface.raised,
                    color: mergeBranch ? accent.cyan.fg : fg[3],
                    cursor: mergeBranch && !merging ? 'pointer' : 'not-allowed',
                  }}
                >
                  {merging ? 'Merging…' : 'Merge'}
                </button>
              </div>
            </div>
          )}

          {log.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1 }}><SectionLabel>Recent Commits</SectionLabel></div>
                <button
                  type="button"
                  onClick={() => void undoLastCommit()}
                  disabled={undoing}
                  title="Undo last commit (soft reset — keeps changes staged)"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    margin: '0 10px 0 0', padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                    border: `1px solid ${border[0]}`, background: 'transparent', color: fg[3],
                    cursor: undoing ? 'not-allowed' : 'pointer',
                  }}
                >
                  <RotateCcw style={{ width: 8, height: 8 }} className={undoing ? 'agent-pulse' : ''} />
                  Undo
                </button>
              </div>
              {log.map((entry) => {
                const isExpanded = expandedCommit === entry.hash
                const cFiles = commitFileMap[entry.hash]
                const isLoadingFiles = commitFilesLoading === entry.hash
                return (
                  <div key={entry.hash} style={{ borderBottom: `1px solid ${border[2]}` }}>
                    <div
                      onClick={() => void toggleCommit(entry.hash)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 6,
                        padding: '5px 10px',
                        cursor: 'pointer',
                        background: isExpanded ? surface.overlay : 'transparent',
                      }}
                    >
                      <ChevronRight
                        style={{
                          width: 11,
                          height: 11,
                          color: fg[4],
                          flexShrink: 0,
                          marginTop: 1,
                          transform: isExpanded ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.12s',
                        }}
                      />
                      <Clock style={{ width: 10, height: 10, color: fg[4], flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: fg[1], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.message}
                        </div>
                        <div style={{ fontSize: 9, color: fg[4], fontFamily: 'monospace', marginTop: 1 }}>
                          {entry.hash.slice(0, 7)}
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ paddingLeft: 28 }}>
                        {isLoadingFiles && (
                          <div style={{ padding: '4px 12px', fontSize: 10, color: fg[3] }}>Loading files…</div>
                        )}
                        {cFiles?.map((cf) => {
                          const { label, color } = statusLabel(cf.status)
                          const isActive = diffFile?.path === cf.path && diffTitle?.startsWith(entry.hash.slice(0, 7))
                          return (
                            <div
                              key={cf.path}
                              onClick={() => void openCommitDiff(entry.hash, cf)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '3px 10px 3px 4px',
                                cursor: 'pointer',
                                background: isActive ? accent.amber.subtle : 'transparent',
                                borderLeft: isActive ? `2px solid ${accent.amber.fg}` : '2px solid transparent',
                              }}
                            >
                              <FileText style={{ width: 10, height: 10, color: fg[4], flexShrink: 0 }} />
                              <span style={{ fontSize: 10, color, flexShrink: 0, fontFamily: 'monospace', fontWeight: 700 }}>{label}</span>
                              <span style={{ fontSize: 11, color: fg[1], flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {cf.path.split('/').pop()}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!branch && !loading && (
            <div
              style={{
                margin: 12,
                padding: '8px 10px',
                background: accent.amber.subtle,
                border: `1px solid ${accent.amber.border}`,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertCircle style={{ width: 12, height: 12, color: accent.amber.fg, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: accent.amber.bright, lineHeight: 1.4 }}>
                Not a git repository. Run <code style={{ fontFamily: 'monospace' }}>git init</code> in the terminal.
              </span>
            </div>
          )}
        </div>

        {diffFile && (
          <div
            style={{
              flexShrink: 0,
              height: 260,
              borderTop: `1px solid ${border[1]}`,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '4px 10px',
                background: surface.overlay,
                borderBottom: `1px solid ${border[1]}`,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: fg[2],
                  flex: 1,
                  fontFamily: 'monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {diffTitle ?? diffFile.path}
              </span>
              <button
                type="button"
                onClick={() => { setDiffFile(null); setDiffData(null); setDiffTitle(null) }}
                title="Close diff"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: fg[3],
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={11} />
              </button>
            </div>
            <div style={{ flex: 1 }}>
              {diffLoading ? (
                <div style={{ padding: 12, fontSize: 11, color: fg[3] }}>Loading…</div>
              ) : (
                <DiffEditor
                  original={diffData?.original ?? ''}
                  modified={diffData?.modified ?? ''}
                  language={languageFromPath(diffFile.path)}
                  theme="lakoora-dark"
                  options={{
                    readOnly: true,
                    renderSideBySide: false,
                    fontSize: 11,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              )}
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  )
}
