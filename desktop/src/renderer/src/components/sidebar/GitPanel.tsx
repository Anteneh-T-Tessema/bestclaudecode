import { useState, useEffect, useCallback } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { GitBranch, RefreshCw, Plus, GitCommit, Clock, CheckCircle, Minus, AlertCircle, X, ArrowUp, ArrowDown, ChevronRight, FileText } from 'lucide-react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useAppStore } from '../../store/useAppStore'
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
}: {
  label: string
  color: string
  name: string
  selected: boolean
  onClick: () => void
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
  }, [refresh])

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
        <span
          style={{
            fontSize: 10,
            color: accent.green.fg,
            fontFamily: 'monospace',
            background: accent.green.subtle,
            border: `1px solid ${accent.green.border}`,
            padding: '1px 6px',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
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

          {log.length > 0 && (
            <div>
              <SectionLabel>Recent Commits</SectionLabel>
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
