import { useState, useRef, useCallback, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { useChatStore } from '../../store/useChatStore'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useProblemsStore } from '../../store/useProblemsStore'
import { useAppStore } from '../../store/useAppStore'
import { toast } from '../../store/useToastStore'
import { surface, border, fg, accent } from '../../design'
import { ModelSelector } from './ModelSelector'

const BASE_SYSTEM_PROMPT = `You are an expert AI coding agent for the Lakoora IDE. Help the user understand, write, debug, and improve their code. Be concise and accurate.

When the user asks you to make a change to a specific file, propose it using this exact format so the IDE can render a one-click review/apply card:

<<<EDIT relative/path/to/file.ext>>>
...the complete new content of the file...
<<<END_EDIT>>>

Always include the FULL file content in the block. You may include prose before/after the block. Only propose edits to files the user referenced or clearly implied.

When the user asks you to run a shell command (install a package, run a script, etc.), propose it using:

<<<RUN>>>
command here
<<<END_RUN>>>

Only one command per block. Do not use this for explanations.

When the user asks you to look something up on a live webpage or perform an action in a browser (things @web's search snippets can't cover — reading a specific page, checking a dashboard, filling a form), propose it using:

<<<BROWSE https://example.com/page>>>
description of what to do or extract on that page
<<<END_BROWSE>>>

Only one URL per block.`

/** Load project-level rules from <projectPath>/.lakoorarules if it exists. */
async function loadProjectRules(projectPath: string | null): Promise<string> {
  if (!projectPath) return ''
  try {
    const rules = await window.api.fs.readFile(`${projectPath}/.lakoorarules`)
    return rules ? `\n\n# Project Rules (.lakoorarules)\n${rules.trim()}` : ''
  } catch {
    return ''
  }
}

/** If message contains @codebase, inject top BM25 results as context. */
async function injectCodebaseContext(content: string): Promise<string> {
  if (!content.includes('@codebase')) return content
  const match = content.match(/@codebase\s+(.+?)(\n|$)/)
  const query = match ? match[1].trim() : content.replace(/@codebase/g, '').trim()
  if (!query) return content

  try {
    const resp = await window.api.search.bm25(query)
    if (!resp?.results?.length) return content

    const blocks = resp.results.slice(0, 5).map((r) => {
      const loc = `${r.file}${r.lineNumber ? `:${r.lineNumber}` : ''}`
      const symbol = r.line.replace(/ -- line \d+$/, '')
      if (r.snippet) return `// ${loc} — ${symbol}\n${r.snippet}`
      return `// ${loc} — ${symbol}`
    })
    const contextBlock = `<codebase_context query="${query}">\n${blocks.join('\n\n---\n\n')}\n</codebase_context>`
    return `${contextBlock}\n\n${content}`
  } catch {
    return content
  }
}

/** If message contains @issue NNN or @pr NNN, inject the GitHub item as context. */
async function injectGithubContext(content: string): Promise<string> {
  const issueMatch = content.match(/@issue\s+(\d+)/)
  const prMatch = content.match(/@pr\s+(\d+)/)
  if (!issueMatch && !prMatch) return content

  let result = content
  if (issueMatch) {
    try {
      const item = await window.api.github.fetchIssue(parseInt(issueMatch[1], 10))
      if (item) {
        const labels = item.labels.length ? `\nLabels: ${item.labels.join(', ')}` : ''
        const comments = item.comments
          .slice(0, 3)
          .map((c) => `@${c.author}: ${c.body.slice(0, 300)}`)
          .join('\n\n')
        const block =
          `<issue_context number="${item.number}" url="${item.url}">\n` +
          `# ${item.title}${labels}\n\n${item.body.slice(0, 1500)}` +
          (comments ? `\n\n## Comments\n${comments}` : '') +
          `\n</issue_context>`
        result = `${block}\n\n${result}`
      }
    } catch { /* leave content unchanged */ }
  }
  if (prMatch) {
    try {
      const item = await window.api.github.fetchPr(parseInt(prMatch[1], 10))
      if (item) {
        const labels = item.labels.length ? `\nLabels: ${item.labels.join(', ')}` : ''
        const block =
          `<pr_context number="${item.number}" url="${item.url}">\n` +
          `# ${item.title}${labels}\n\n${item.body.slice(0, 1500)}` +
          `\n</pr_context>`
        result = `${block}\n\n${result}`
      }
    } catch { /* leave content unchanged */ }
  }
  return result
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b[()][AB012]|\r/g

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_RE, '')
}

/** If message contains @terminal, inject last ~100 lines of terminal output. */
function injectTerminalContext(content: string): string {
  if (!content.includes('@terminal')) return content
  const raw = useAppStore.getState().terminalOutput
  if (!raw.trim()) return content.replace('@terminal', '[No terminal output captured yet]')
  const clean = stripAnsi(raw)
  const lines = clean.split('\n')
  const snippet = lines.slice(-100).join('\n').slice(-4000)
  return content.replace('@terminal', `\n\nTerminal output (last ~100 lines):\n\`\`\`\n${snippet}\n\`\`\``)
}

/** If message contains @docs <pkg>, inject package documentation as context. */
async function injectDocsContext(content: string): Promise<string> {
  if (!content.includes('@docs')) return content
  const match = content.match(/@docs\s+([\w@/.-]+)/)
  const pkg = match ? match[1].trim() : ''
  if (!pkg) return content

  try {
    const doc = await window.api.search.docs(pkg)
    if (!doc) return content
    const block =
      `<docs_context package="${doc.name}" version="${doc.version}" source="${doc.source}" url="${doc.url}">\n` +
      `${doc.summary}\n\n${doc.description.slice(0, 1000)}\n</docs_context>`
    return `${block}\n\n${content}`
  } catch {
    return content
  }
}

/** If message contains @web, inject live web search results as context. */
async function injectWebContext(content: string): Promise<string> {
  if (!content.includes('@web')) return content
  const match = content.match(/@web\s+(.+?)(\n|$)/)
  const query = match ? match[1].trim() : content.replace(/@web/g, '').trim()
  if (!query) return content

  try {
    const results = await window.api.search.web(query)
    if (!results?.length) return content

    const blocks = results.slice(0, 5).map((r) => {
      const snippet = r.snippet ? `\n${r.snippet}` : ''
      return `[${r.title}]\n${r.url}${snippet}`
    })
    const contextBlock = `<web_context query="${query}">\n${blocks.join('\n\n---\n\n')}\n</web_context>`
    return `${contextBlock}\n\n${content}`
  } catch {
    return content
  }
}

const MENTIONS = [
  { tag: '@selection', desc: 'Currently selected editor text' },
  { tag: '@file',      desc: 'Full content of the active file (or pick any file)' },
  { tag: '@folder',    desc: 'List files in a project folder' },
  { tag: '@terminal',  desc: 'Last ~100 lines of terminal output' },
  { tag: '@problems',  desc: 'Current diagnostics / lint errors' },
  { tag: '@git',       desc: 'Staged git diff' },
  { tag: '@codebase',  desc: 'BM25 search across the project' },
  { tag: '@web',       desc: 'Live web search results' },
  { tag: '@docs',      desc: 'Package documentation' },
  { tag: '@issue',     desc: 'GitHub issue by number' },
  { tag: '@pr',        desc: 'GitHub pull request by number' },
]

export function ChatInput() {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionStartRef = useRef<number>(-1)

  // File picker state (triggered by @file <query>)
  const [fileQuery, setFileQuery] = useState<string | null>(null)
  const [filePickerIndex, setFilePickerIndex] = useState(0)
  const filePickerStartRef = useRef<number>(-1)
  const allFilesRef = useRef<string[]>([])
  const filesLoadedForRef = useRef<string | null>(null)

  // Folder picker state (triggered by @folder <query>)
  const [folderQuery, setFolderQuery] = useState<string | null>(null)
  const [folderPickerIndex, setFolderPickerIndex] = useState(0)
  const folderPickerStartRef = useRef<number>(-1)

  const {
    activeModel,
    isStreaming,
    activeStreamId,
    addUserMessage,
    startAssistantMessage,
    appendDelta,
    finalizeMessage,
    setStreaming,
  } = useChatStore()

  const getActiveTab = useEditorStore((s) => s.getActiveTab)
  const projectPath = useSettingsStore((s) => s.projectPath)

  const send = useCallback(async (overrideContent?: string) => {
    const content = (overrideContent !== undefined ? overrideContent : text).trim()
    if (!content || isStreaming) return
    if (overrideContent === undefined) setText('')

    // @selection — attach currently selected editor text
    let finalContent = content
    const activeTab = getActiveTab()
    const editorSelection = useEditorStore.getState().editorSelection
    if (content.includes('@selection') && editorSelection) {
      finalContent = finalContent.replace(
        '@selection',
        `\n\nSelected code (${activeTab?.label ?? 'editor'}):\n\`\`\`${activeTab?.language ?? ''}\n${editorSelection}\n\`\`\``
      )
    }

    // @git — inject local staged diff
    if (finalContent.includes('@git')) {
      const projectPath = useSettingsStore.getState().projectPath
      let gitBlock = 'No staged changes.'
      if (projectPath) {
        try {
          const diff = await window.api.git.stagedDiff(projectPath)
          gitBlock = diff.trim() ? diff.slice(0, 6000) : 'No staged changes.'
        } catch { /* ignore */ }
      }
      finalContent = finalContent.replace('@git', `\n\nStaged diff:\n\`\`\`diff\n${gitBlock}\n\`\`\``)
    }

    // @problems — inject current diagnostics
    if (finalContent.includes('@problems')) {
      const problems = useProblemsStore.getState().problems
      const block = problems.length === 0
        ? 'No problems found.'
        : problems.map((p) => `${p.severity.toUpperCase()} ${p.filePath}:${p.line}:${p.col} — ${p.message}`).join('\n')
      finalContent = finalContent.replace('@problems', `\n\nCurrent problems:\n\`\`\`\n${block}\n\`\`\``)
    }

    // @terminal — inject last ~100 lines of captured terminal output
    finalContent = injectTerminalContext(finalContent)

    // @file:path — inject a specific file chosen via the picker
    const fileRefRe = /@file:([^\s]+)/g
    let fileRefMatch: RegExpExecArray | null
    while ((fileRefMatch = fileRefRe.exec(finalContent)) !== null) {
      const relPath = fileRefMatch[1]
      const pp = useSettingsStore.getState().projectPath
      if (pp) {
        try {
          const fileContent = await window.api.fs.readFile(`${pp}/${relPath}`)
          const ext = relPath.split('.').pop() ?? ''
          finalContent = finalContent.replace(
            fileRefMatch[0],
            `\n\nFile \`${relPath}\`:\n\`\`\`${ext}\n${fileContent.slice(0, 8000)}\n\`\`\``
          )
        } catch { /* file not found, leave token */ }
      }
    }

    // @folder:path — list all files under that directory as context
    const folderRefRe = /@folder:([^\s]+)/g
    let folderRefMatch: RegExpExecArray | null
    while ((folderRefMatch = folderRefRe.exec(finalContent)) !== null) {
      const relDir = folderRefMatch[1]
      const pp = useSettingsStore.getState().projectPath
      if (pp) {
        try {
          const entries = await window.api.fs.readDir(`${pp}/${relDir}`) as Array<{ name: string; path: string; isDirectory: boolean }>
          const tree = entries.map((e) => `${e.isDirectory ? '📁' : '📄'} ${e.name}`).join('\n')
          finalContent = finalContent.replace(
            folderRefMatch[0],
            `\n\nFolder \`${relDir}\`:\n\`\`\`\n${tree}\n\`\`\``
          )
        } catch { /* folder not found, leave token */ }
      }
    }

    // @file — attach current editor content (plain @file with no path)
    if (finalContent.includes('@file') && activeTab) {
      finalContent = finalContent.replace(
        '@file',
        `\n\nCurrent file (${activeTab.label}):\n\`\`\`${activeTab.language}\n${activeTab.content}\n\`\`\``
      )
    }

    // @codebase — inject BM25 context block
    finalContent = await injectCodebaseContext(finalContent)

    // @web — inject live web search results
    finalContent = await injectWebContext(finalContent)

    // @issue / @pr — inject GitHub item context
    finalContent = await injectGithubContext(finalContent)

    // @docs — inject package documentation context
    finalContent = await injectDocsContext(finalContent)

    const { sessions, activeSessionId } = useChatStore.getState()
    const activeSession = sessions.find((s) => s.id === activeSessionId)
    const messages = (activeSession?.messages ?? []).map((m) => ({ role: m.role, content: m.content }))

    // E2E test hook: broadcast the final enriched content (with any @-context
    // blocks already injected) so tests can assert on what's being sent without
    // having to patch contextBridge APIs (which are sealed in Electron 28+).
    window.dispatchEvent(new CustomEvent('lakoora:e2e:beforeSend', { detail: { content: finalContent } }))

    addUserMessage(finalContent)

    const assistantId = startAssistantMessage()

    // Build system prompt: base + optional .lakoorarules
    const projectRules = await loadProjectRules(projectPath)
    const systemPrompt = BASE_SYSTEM_PROMPT + projectRules

    try {
      const streamId = await window.api.ai.streamChat({
        messages: [...messages, { role: 'user', content: finalContent }],
        model: activeModel,
        systemPrompt,
      })

      setStreaming(streamId)

      await new Promise<void>((resolve, reject) => {
        const unChunk = window.api.ai.onChunk(streamId, (delta) => {
          appendDelta(assistantId, delta)
        })
        const unDone = window.api.ai.onDone(streamId, () => {
          unChunk(); unDone(); unError()
          resolve()
        })
        const unError = window.api.ai.onError(streamId, (err) => {
          unChunk(); unDone(); unError()
          reject(new Error(err))
        })
      })

      finalizeMessage(assistantId)
    } catch (err) {
      finalizeMessage(assistantId)
      toast.error(`Chat error: ${(err as Error).message}`)
    }
  }, [text, isStreaming, activeModel, addUserMessage, startAssistantMessage, appendDelta, finalizeMessage, setStreaming, getActiveTab, projectPath])

  useEffect(() => {
    const handler = (e: Event) => {
      const { content } = (e as CustomEvent<{ content: string }>).detail
      send(content)
    }
    window.addEventListener('lakoora:chat:regenerate', handler)
    return () => window.removeEventListener('lakoora:chat:regenerate', handler)
  }, [send])

  const abort = () => {
    if (activeStreamId) {
      window.api.ai.abortStream(activeStreamId)
      setStreaming(null)
    }
  }

  const filteredMentions = mentionQuery !== null
    ? MENTIONS.filter((m) => m.tag.slice(1).startsWith(mentionQuery.toLowerCase()))
    : []

  const closeMention = () => {
    setMentionQuery(null)
    setMentionIndex(0)
    mentionStartRef.current = -1
  }

  const closeFilePicker = () => {
    setFileQuery(null)
    setFilePickerIndex(0)
    filePickerStartRef.current = -1
  }

  const filteredFiles = fileQuery !== null
    ? allFilesRef.current.filter((f) => f.toLowerCase().includes(fileQuery.toLowerCase())).slice(0, 12)
    : []

  const acceptFilePicker = (relPath: string) => {
    const ta = textareaRef.current
    if (!ta || filePickerStartRef.current < 0) return
    const before = text.slice(0, filePickerStartRef.current)
    const after = text.slice(ta.selectionStart)
    const insert = `@file:${relPath} `
    const next = before + insert + after
    setText(next)
    closeFilePicker()
    requestAnimationFrame(() => {
      if (!ta) return
      const pos = before.length + insert.length
      ta.setSelectionRange(pos, pos)
      ta.focus()
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
    })
  }

  const closeFolderPicker = () => {
    setFolderQuery(null)
    setFolderPickerIndex(0)
    folderPickerStartRef.current = -1
  }

  const allDirs = (() => {
    const set = new Set<string>()
    for (const f of allFilesRef.current) {
      const parts = f.split('/')
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
    }
    return [...set].sort()
  })()

  const filteredDirs = folderQuery !== null
    ? allDirs.filter((d) => d.toLowerCase().includes(folderQuery.toLowerCase())).slice(0, 12)
    : []

  const acceptFolderPicker = (relDir: string) => {
    const ta = textareaRef.current
    if (!ta || folderPickerStartRef.current < 0) return
    const before = text.slice(0, folderPickerStartRef.current)
    const after = text.slice(ta.selectionStart)
    const insert = `@folder:${relDir} `
    const next = before + insert + after
    setText(next)
    closeFolderPicker()
    requestAnimationFrame(() => {
      if (!ta) return
      const pos = before.length + insert.length
      ta.setSelectionRange(pos, pos)
      ta.focus()
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
    })
  }

  const acceptMention = (tag: string) => {
    const ta = textareaRef.current
    if (!ta || mentionStartRef.current < 0) return
    const before = text.slice(0, mentionStartRef.current)
    const after = text.slice(ta.selectionStart)
    // tags like @issue / @pr need a trailing space for the number argument
    const needsArg = tag === '@issue' || tag === '@pr' || tag === '@codebase' || tag === '@web' || tag === '@docs'
    const insert = needsArg ? `${tag} ` : `${tag} `
    const next = before + insert + after
    setText(next)
    closeMention()
    requestAnimationFrame(() => {
      if (!ta) return
      const pos = before.length + insert.length
      ta.setSelectionRange(pos, pos)
      ta.focus()
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
    })
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)
    const cursor = e.target.selectionStart ?? val.length
    const slice = val.slice(0, cursor)

    // Lazy-load file list helper (shared by @file and @folder)
    const ensureFiles = () => {
      const pp = useSettingsStore.getState().projectPath
      if (pp && filesLoadedForRef.current !== pp) {
        filesLoadedForRef.current = pp
        window.api.fs.findFiles(pp).then((files) => { allFilesRef.current = files }).catch(() => {})
      }
    }

    // Detect @folder <query> — folder picker mode (check before @file)
    const folderMatch = slice.match(/@folder ([^\s@]*)$/)
    if (folderMatch) {
      folderPickerStartRef.current = slice.length - folderMatch[0].length
      setFolderQuery(folderMatch[1])
      setFolderPickerIndex(0)
      closeFilePicker()
      closeMention()
      ensureFiles()
      return
    }
    closeFolderPicker()

    // Detect @file <query> — file picker mode
    const fileMatch = slice.match(/@file ([^\s@]*)$/)
    if (fileMatch) {
      filePickerStartRef.current = slice.length - fileMatch[0].length
      setFileQuery(fileMatch[1])
      setFilePickerIndex(0)
      closeMention()
      ensureFiles()
      return
    }
    closeFilePicker()

    // Detect @mention trigger
    const atIdx = slice.lastIndexOf('@')
    if (atIdx !== -1) {
      const before = slice[atIdx - 1]
      const isWordStart = atIdx === 0 || before === ' ' || before === '\n'
      if (isWordStart) {
        const fragment = slice.slice(atIdx + 1)
        if (!fragment.includes(' ') && !fragment.includes('\n')) {
          mentionStartRef.current = atIdx
          setMentionQuery(fragment)
          setMentionIndex(0)
          return
        }
      }
    }
    closeMention()
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (folderQuery !== null && filteredDirs.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFolderPickerIndex((i) => (i + 1) % filteredDirs.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFolderPickerIndex((i) => (i - 1 + filteredDirs.length) % filteredDirs.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptFolderPicker(filteredDirs[folderPickerIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); closeFolderPicker(); return }
    }
    if (fileQuery !== null && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFilePickerIndex((i) => (i + 1) % filteredFiles.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFilePickerIndex((i) => (i - 1 + filteredFiles.length) % filteredFiles.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptFilePicker(filteredFiles[filePickerIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); closeFilePicker(); return }
    }
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % filteredMentions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + filteredMentions.length) % filteredMentions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptMention(filteredMentions[mentionIndex].tag)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMention()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div
      style={{
        padding: '10px 12px',
        borderTop: `1px solid ${border[1]}`,
        background: surface.surface,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* @file fuzzy picker popup */}
      {fileQuery !== null && filteredFiles.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 12,
            right: 12,
            marginBottom: 4,
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
            zIndex: 100,
          }}
        >
          {filteredFiles.map((f, i) => {
            const name = f.split('/').pop() ?? f
            const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''
            return (
              <button
                key={f}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); acceptFilePicker(f) }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 12px',
                  background: i === filePickerIndex ? surface.surface : 'transparent',
                  border: 'none',
                  borderBottom: i < filteredFiles.length - 1 ? `1px solid ${border[2]}` : 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 12, color: fg[0], fontFamily: 'monospace' }}>{name}</span>
                {dir && <span style={{ fontSize: 10, color: fg[3], fontFamily: 'monospace' }}>{dir}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* @folder picker popup */}
      {folderQuery !== null && filteredDirs.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 12,
            right: 12,
            marginBottom: 4,
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
            zIndex: 100,
          }}
        >
          {filteredDirs.map((d, i) => {
            const name = d.split('/').pop() ?? d
            const parent = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''
            return (
              <button
                key={d}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); acceptFolderPicker(d) }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 12px',
                  background: i === folderPickerIndex ? surface.surface : 'transparent',
                  border: 'none',
                  borderBottom: i < filteredDirs.length - 1 ? `1px solid ${border[2]}` : 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 11, color: accent.amber.fg }}>📁</span>
                <span style={{ fontSize: 12, color: fg[0], fontFamily: 'monospace' }}>{name}</span>
                {parent && <span style={{ fontSize: 10, color: fg[3], fontFamily: 'monospace' }}>{parent}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* @mention autocomplete popup */}
      {mentionQuery !== null && filteredMentions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 12,
            right: 12,
            marginBottom: 4,
            background: surface.raised,
            border: `1px solid ${border[0]}`,
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
            zIndex: 100,
          }}
        >
          {filteredMentions.map((m, i) => (
            <button
              key={m.tag}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); acceptMention(m.tag) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '7px 12px',
                background: i === mentionIndex ? surface.surface : 'transparent',
                border: 'none',
                borderBottom: i < filteredMentions.length - 1 ? `1px solid ${border[2]}` : 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: accent.violet.fg, minWidth: 90 }}>{m.tag}</span>
              <span style={{ fontSize: 11, color: fg[3] }}>{m.desc}</span>
            </button>
          ))}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          background: surface.raised,
          border: `1px solid ${border[0]}`,
          borderRadius: 8,
          padding: '6px 10px',
        }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKey}
          placeholder="Ask anything… @selection @file @folder @terminal @problems @codebase @web @docs · Shift+Enter new line"
          rows={1}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize: 13,
            color: fg[0],
            lineHeight: 1.5,
            maxHeight: 160,
            overflowY: 'auto',
            fontFamily: 'inherit',
          }}
          onInput={(e) => {
            const t = e.currentTarget
            t.style.height = 'auto'
            t.style.height = `${Math.min(t.scrollHeight, 160)}px`
          }}
        />
        {isStreaming ? (
          <button
            onClick={abort}
            title="Stop generation"
            style={{
              background: accent.red.subtle,
              border: `1px solid ${accent.red.border}`,
              borderRadius: 6,
              padding: '5px 8px',
              cursor: 'pointer',
              color: accent.red.fg,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Square size={13} />
          </button>
        ) : (
          <button
            onClick={() => send()}
            disabled={!text.trim()}
            title="Send (Enter)"
            style={{
              background: text.trim() ? accent.violet.fg : surface.raised,
              border: 'none',
              borderRadius: 6,
              padding: '5px 8px',
              cursor: text.trim() ? 'pointer' : 'not-allowed',
              color: text.trim() ? '#fff' : fg[3],
              display: 'flex',
              alignItems: 'center',
              transition: 'background 0.15s',
            }}
          >
            <Send size={13} />
          </button>
        )}
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ModelSelector />
        <span style={{ fontSize: 10, color: fg[3] }}>
          Enter · @selection @file @folder @terminal @problems @codebase @web @docs @issue @pr
        </span>
        {text.length > 0 && (
          <span style={{ fontSize: 10, color: text.length > 4000 ? accent.red.fg : fg[4], marginLeft: 'auto' }}>
            {text.length} · ~{Math.ceil(text.length / 4)} tok
          </span>
        )}
      </div>
    </div>
  )
}
