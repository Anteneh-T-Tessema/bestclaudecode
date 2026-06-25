import { useState, useRef, useCallback, useEffect } from 'react'
import { Send, Square, X, ImageIcon } from 'lucide-react'
import { useChatStore } from '../../store/useChatStore'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useProblemsStore } from '../../store/useProblemsStore'
import { useAppStore } from '../../store/useAppStore'
import { toast } from '../../store/useToastStore'
import { surface, border, fg, accent } from '../../design'
import { ModelSelector } from './ModelSelector'
import { extractSymbols } from '../sidebar/OutlinePanel'

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

/** Escape a string for safe interpolation into an XML-ish attribute value. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** If message contains @screenshot:<path>, describe the image via the vision model. */
async function injectScreenshotContext(content: string): Promise<string> {
  const re = /@screenshot:([^\s]+)/g
  let result = content
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    const imgPath = match[1]
    try {
      const resp = await window.api.search.screenshot(imgPath)
      const block = resp?.description
        ? `\n\n<screenshot path="${imgPath}">\n${resp.description}\n</screenshot>`
        : `\n\n[Screenshot ${imgPath} — could not be described]`
      result = result.replace(match[0], block)
    } catch {
      result = result.replace(match[0], `\n\n[Screenshot ${imgPath} — could not be described]`)
    }
  }
  return result
}

/**
 * If message contains @memory <query>, inject agent memory entries matching that
 * specific query — distinct from the automatic <agent_memory> baseline (Gap 34),
 * which always queries using the raw message text instead of a user-chosen topic.
 */
async function injectMemoryContext(content: string): Promise<string> {
  if (!content.includes('@memory')) return content
  const match = content.match(/@memory\s+(.+?)(\n|$)/)
  const query = match ? match[1].trim() : ''
  const tagToStrip = match ? match[0] : '@memory'
  if (!query) return content.replace(tagToStrip, '').trim()

  try {
    const memories = await window.api.memory.query(query)
    if (!memories?.length) return content.replace(tagToStrip, '').trim()
    const blocks = memories.map((m) => `**${m.key}**${m.tags.length ? ` [${m.tags.join(', ')}]` : ''}\n${m.content}`)
    const contextBlock = `<agent_memory_query query="${escapeAttr(query)}">\n${blocks.join('\n\n')}\n</agent_memory_query>`
    return `${contextBlock}\n\n${content.replace(tagToStrip, '').trim()}`
  } catch {
    return content
  }
}

/** If message contains @diff, inject the full working-tree diff vs HEAD. */
async function injectDiffContext(content: string, projectPath: string | null): Promise<string> {
  if (!content.includes('@diff')) return content
  let diffBlock = 'No changes vs HEAD.'
  if (projectPath) {
    try {
      const diff = await window.api.git.headDiff(projectPath)
      diffBlock = diff.trim() ? diff.slice(0, 8000) : 'No changes vs HEAD.'
    } catch { /* ignore */ }
  }
  return content.replace('@diff', `\n\nWorking-tree diff vs HEAD:\n\`\`\`diff\n${diffBlock}\n\`\`\``)
}

/** If message contains @codebase, inject top hybrid (BM25 + vector) search results as context. */
async function injectCodebaseContext(content: string): Promise<string> {
  if (!content.includes('@codebase')) return content
  const match = content.match(/@codebase\s+(.+?)(\n|$)/)
  const query = match ? match[1].trim() : content.replace(/@codebase/g, '').trim()
  if (!query) return content

  try {
    const resp = await window.api.search.vector(query, true)
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

function extractImportedPackages(content: string, language: string): string[] {
  const pkgs = new Set<string>()
  const addPkg = (raw: string) => {
    if (!raw || raw.startsWith('.') || raw.startsWith('/')) return
    const pkg = raw.startsWith('@') ? raw.split('/').slice(0, 2).join('/') : raw.split('/')[0]
    if (pkg) pkgs.add(pkg)
  }
  if (language === 'typescript' || language === 'javascript') {
    const re = /(?:from|import)\s+['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) addPkg(m[1])
    const req = /require\(['"]([^'"]+)['"]\)/g
    while ((m = req.exec(content)) !== null) addPkg(m[1])
  } else if (language === 'python') {
    const imp = /^import\s+(\w+)/gm
    const frm = /^from\s+(\w+)/gm
    let m: RegExpExecArray | null
    while ((m = imp.exec(content)) !== null) pkgs.add(m[1])
    while ((m = frm.exec(content)) !== null) pkgs.add(m[1])
  } else if (language === 'rust') {
    const use_ = /^use\s+([a-z_][a-z0-9_]*)/gm
    const skip = new Set(['std', 'core', 'alloc', 'super', 'self', 'crate'])
    let m: RegExpExecArray | null
    while ((m = use_.exec(content)) !== null) { if (!skip.has(m[1])) pkgs.add(m[1]) }
  } else if (language === 'go') {
    const re = /import\s+["']([^"'.][^"']+)["']/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) pkgs.add(m[1].split('/').pop() ?? m[1])
  }
  return [...pkgs].sort()
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

/** Gap 77 — @depends <file>: inject what a file imports (its dependencies). */
async function injectDependsContext(content: string): Promise<string> {
  if (!content.includes('@depends')) return content
  const match = content.match(/@depends\s+(\S+)/)
  const file = match ? match[1].trim() : ''
  if (!file) return content.replace(/@depends\s*/g, '').trim()

  try {
    const results = await window.api.search.dependsOn(file)
    const tagToStrip = match ? match[0] : '@depends'
    if (!results?.length) return content.replace(tagToStrip, `(no dependencies found for \`${file}\`)`).trim()
    const block = `<depends_on file="${file}">\n${results.join('\n')}\n</depends_on>`
    return `${block}\n\n${content.replace(tagToStrip, '').trim()}`
  } catch {
    return content
  }
}

/** Gap 77 — @dependents <file>: inject which files import a given file. */
async function injectDependentsContext(content: string): Promise<string> {
  if (!content.includes('@dependents')) return content
  const match = content.match(/@dependents\s+(\S+)/)
  const file = match ? match[1].trim() : ''
  if (!file) return content.replace(/@dependents\s*/g, '').trim()

  try {
    const results = await window.api.search.dependentsOf(file)
    const tagToStrip = match ? match[0] : '@dependents'
    if (!results?.length) return content.replace(tagToStrip, `(no dependents found for \`${file}\`)`).trim()
    const block = `<dependents_of file="${file}">\n${results.join('\n')}\n</dependents_of>`
    return `${block}\n\n${content.replace(tagToStrip, '').trim()}`
  } catch {
    return content
  }
}

/** Gap 81 — @diffreport [ref]: inject the git diff block relative to a ref (default HEAD). */
async function injectDiffReportContext(content: string): Promise<string> {
  if (!content.includes('@diffreport')) return content
  const match = content.match(/@diffreport\s+(\S+)/)
  const ref = match ? match[1].trim() : 'HEAD'
  const tagToStrip = match ? match[0] : '@diffreport'
  try {
    const result = await window.api.context.withDiff(ref)
    if (!result?.text) return content.replace(tagToStrip, `(no diff for \`${ref}\`)`).trim()
    return `${result.text}\n\n${content.replace(tagToStrip, '').trim()}`
  } catch {
    return content
  }
}

/** Gap 73 — @callers <fn>: inject Python + TS call sites for a function name. */
async function injectCallersContext(content: string): Promise<string> {
  if (!content.includes('@callers')) return content
  const match = content.match(/@callers\s+(\S+)/)
  const fn = match ? match[1].trim() : ''
  if (!fn) return content.replace(/@callers\s*/g, '').trim()

  try {
    const results = await window.api.search.callers(fn)
    const tagToStrip = match ? match[0] : '@callers'
    if (!results?.length) return content.replace(tagToStrip, `(no call sites found for \`${fn}\`)`).trim()
    const lines = results.map((r) => `${r.file}:${r.line}`).join('\n')
    const block = `<callers fn="${fn}">\n${lines}\n</callers>`
    return `${block}\n\n${content.replace(tagToStrip, '').trim()}`
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
  { tag: '@selection',  desc: 'Currently selected editor text' },
  { tag: '@file',       desc: 'Full content of the active file (or pick any file)' },
  { tag: '@outline',    desc: 'Symbol map (classes, functions, methods) of the active file' },
  { tag: '@folder',     desc: 'List files in a project folder' },
  { tag: '@terminal',   desc: 'Last ~100 lines of terminal output' },
  { tag: '@problems',   desc: 'Current diagnostics / lint errors' },
  { tag: '@git',        desc: 'Staged git diff' },
  { tag: '@diff',       desc: 'Full working-tree diff vs HEAD' },
  { tag: '@memory',     desc: 'Agent memory entries matching a topic' },
  { tag: '@codebase',   desc: 'BM25 search across the project' },
  { tag: '@web',        desc: 'Live web search results' },
  { tag: '@diffreport', desc: 'Git diff block relative to a ref (default HEAD)' },
  { tag: '@callers',    desc: 'All call sites for a function name (Python + TS)' },
  { tag: '@depends',    desc: 'What a file imports (its local dependencies)' },
  { tag: '@dependents', desc: 'Which files import a given file (reverse deps)' },
  { tag: '@docs',       desc: 'Package documentation' },
  { tag: '@issue',      desc: 'GitHub issue by number' },
  { tag: '@pr',         desc: 'GitHub pull request by number' },
  { tag: '@screenshot', desc: 'Describe a screenshot image file' },
]

export function ChatInput() {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Pasted/dropped image attachments (base64 data URLs)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const imageFileInputRef = useRef<HTMLInputElement>(null)

  const addImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPendingImages((prev) => (prev.length >= 4 ? prev : [...prev, reader.result as string]))
      }
    }
    reader.readAsDataURL(file)
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    let hasImage = false
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        hasImage = true
        const file = item.getAsFile()
        if (file) addImageFile(file)
      }
    }
    if (hasImage) e.preventDefault()
  }, [addImageFile])

  const handleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    const hasImage = Array.from(files).some((f) => f.type.startsWith('image/'))
    if (!hasImage) return
    e.preventDefault()
    for (const f of files) addImageFile(f)
  }, [addImageFile])

  const removeImage = useCallback((idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

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

  // Docs picker state (triggered by @docs <query>)
  const [docsQuery, setDocsQuery] = useState<string | null>(null)
  const [docsPickerIndex, setDocsPickerIndex] = useState(0)
  const docsPickerStartRef = useRef<number>(-1)

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
    const images = overrideContent !== undefined ? [] : pendingImages
    if ((!content && images.length === 0) || isStreaming) return
    if (overrideContent === undefined) { setText(''); setPendingImages([]) }

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

    // @diff — inject full working-tree diff vs HEAD
    finalContent = await injectDiffContext(finalContent, projectPath)

    // @screenshot:<path> — describe an image file via the vision model
    finalContent = await injectScreenshotContext(finalContent)

    // @memory <query> — inject agent memory entries matching a specific topic
    finalContent = await injectMemoryContext(finalContent)

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

    // Paths the user already pulled in manually — fed into context:assemble
    // below so the automatic baseline retrieval doesn't duplicate them.
    const manuallyMentionedPaths: string[] = []

    // @file:path — inject a specific file chosen via the picker
    const fileRefRe = /@file:([^\s]+)/g
    let fileRefMatch: RegExpExecArray | null
    while ((fileRefMatch = fileRefRe.exec(finalContent)) !== null) {
      const relPath = fileRefMatch[1]
      manuallyMentionedPaths.push(relPath)
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
      manuallyMentionedPaths.push(relDir)
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

    // Gap 87 — @outline: inject the current file's symbol map (classes, functions, methods)
    if (finalContent.includes('@outline') && activeTab) {
      const symbols = extractSymbols(activeTab.content, activeTab.language)
      const body = symbols.length > 0
        ? symbols.map((s) => `${'  '.repeat(Math.floor(s.indent / 2))}${s.kind} ${s.name} (line ${s.line})`).join('\n')
        : '(no symbols found)'
      finalContent = finalContent.replace(
        '@outline',
        `\n\nOutline of ${activeTab.label}:\n\`\`\`\n${body}\n\`\`\``
      )
    }

    // @codebase — inject BM25 context block
    finalContent = await injectCodebaseContext(finalContent)

    // @web — inject live web search results
    finalContent = await injectWebContext(finalContent)

    // @diffreport — inject git diff context block relative to a ref
    finalContent = await injectDiffReportContext(finalContent)

    // @callers — inject call-graph results for a function name
    finalContent = await injectCallersContext(finalContent)

    // @depends / @dependents — inject import-graph context
    finalContent = await injectDependsContext(finalContent)
    finalContent = await injectDependentsContext(finalContent)

    // @issue / @pr — inject GitHub item context
    finalContent = await injectGithubContext(finalContent)

    // @docs — inject package documentation context
    finalContent = await injectDocsContext(finalContent)

    // Gap 29 — automatic hybrid retrieval baseline, runs unconditionally (not
    // gated on any @-mention) using the raw user input (`content`, not
    // `finalContent`) as the retrieval query so expanded file/issue/web blocks
    // don't pollute it. Deduped against manuallyMentionedPaths server-side.
    if (content.trim()) {
      try {
        const ctx = await window.api.search.assembleContext(content, manuallyMentionedPaths)
        if (ctx?.results?.length) {
          const blocks = ctx.results.map((r) => `// ${r.file}${r.lineNumber ? `:${r.lineNumber}` : ''} — ${r.line}\n${r.snippet ?? ''}`)
          finalContent = `<auto_context query="${escapeAttr(content)}">\n${blocks.join('\n\n---\n\n')}\n</auto_context>\n\n${finalContent}`
        }
      } catch { /* never block sending on a context-assembly failure */ }
    }

    // Gap 34 — automatic agent-memory baseline, mirrors the Gap 29 auto_context
    // block above but pulls from persisted decision/preference memory instead
    // of codebase retrieval. Uses a distinct tag so it's visually separable.
    if (content.trim()) {
      try {
        const memories = await window.api.memory.query(content)
        if (memories?.length) {
          const blocks = memories.map((m) => `**${m.key}**${m.tags.length ? ` [${m.tags.join(', ')}]` : ''}\n${m.content}`)
          finalContent = `<agent_memory>\n${blocks.join('\n\n')}\n</agent_memory>\n\n${finalContent}`
        }
      } catch { /* never block sending on a memory-query failure */ }
    }

    const { sessions, activeSessionId } = useChatStore.getState()
    const activeSession = sessions.find((s) => s.id === activeSessionId)
    const messages = (activeSession?.messages ?? []).map((m) => ({ role: m.role, content: m.content, images: m.images }))

    // E2E test hook: broadcast the final enriched content (with any @-context
    // blocks already injected) so tests can assert on what's being sent without
    // having to patch contextBridge APIs (which are sealed in Electron 28+).
    window.dispatchEvent(new CustomEvent('lakoora:e2e:beforeSend', { detail: { content: finalContent } }))

    addUserMessage(finalContent, images)

    const assistantId = startAssistantMessage()

    // Build system prompt: base + global rules + optional .lakoorarules
    const globalRules = useSettingsStore.getState().globalRules
    const globalRulesBlock = globalRules.trim() ? `\n\n# Global Rules\n${globalRules.trim()}` : ''
    const projectRules = await loadProjectRules(projectPath)
    const systemPrompt = BASE_SYSTEM_PROMPT + globalRulesBlock + projectRules

    try {
      const streamId = await window.api.ai.streamChat({
        messages: [...messages, { role: 'user', content: finalContent, images }],
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

  const closeDocsPicker = () => {
    setDocsQuery(null)
    setDocsPickerIndex(0)
    docsPickerStartRef.current = -1
  }

  const activeTabForDocs = getActiveTab()
  const discoveredPackages = docsQuery !== null && activeTabForDocs
    ? extractImportedPackages(activeTabForDocs.content, activeTabForDocs.language)
    : []
  const filteredDocs = discoveredPackages.filter((p) =>
    docsQuery === '' || p.toLowerCase().includes((docsQuery ?? '').toLowerCase())
  ).slice(0, 12)

  const acceptDocsPicker = (pkg: string) => {
    const ta = textareaRef.current
    if (!ta || docsPickerStartRef.current < 0) return
    const before = text.slice(0, docsPickerStartRef.current)
    const after = text.slice(ta.selectionStart)
    const insert = `@docs ${pkg} `
    setText(before + insert + after)
    closeDocsPicker()
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

    // Detect @docs <query> — docs package picker from current file imports
    const docsMatch = slice.match(/@docs ([^\s@]*)$/)
    if (docsMatch) {
      docsPickerStartRef.current = slice.length - docsMatch[0].length
      setDocsQuery(docsMatch[1])
      setDocsPickerIndex(0)
      closeFolderPicker()
      closeFilePicker()
      closeMention()
      return
    }
    closeDocsPicker()

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
    if (docsQuery !== null && filteredDocs.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setDocsPickerIndex((i) => (i + 1) % filteredDocs.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setDocsPickerIndex((i) => (i - 1 + filteredDocs.length) % filteredDocs.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptDocsPicker(filteredDocs[docsPickerIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); closeDocsPicker(); return }
    }
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

      {/* @docs package picker popup */}
      {docsQuery !== null && filteredDocs.length > 0 && (
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
          <div style={{ padding: '4px 12px 2px', fontSize: 9, color: fg[4], borderBottom: `1px solid ${border[2]}` }}>
            Packages imported in {activeTabForDocs?.label ?? 'current file'}
          </div>
          {filteredDocs.map((pkg, i) => (
            <button
              key={pkg}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); acceptDocsPicker(pkg) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 12px',
                background: i === docsPickerIndex ? surface.surface : 'transparent',
                border: 'none',
                borderBottom: i < filteredDocs.length - 1 ? `1px solid ${border[2]}` : 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 11, color: accent.cyan.fg }}>📦</span>
              <span style={{ fontSize: 12, color: fg[0], fontFamily: 'monospace' }}>{pkg}</span>
            </button>
          ))}
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
      {pendingImages.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '0 2px 6px', flexWrap: 'wrap' }}>
          {pendingImages.map((src, i) => (
            <div key={i} style={{ position: 'relative', width: 48, height: 48, borderRadius: 6, overflow: 'hidden', border: `1px solid ${border[0]}` }}>
              <img src={src} alt={`attachment ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <button
                type="button"
                onClick={() => removeImage(i)}
                title="Remove image"
                style={{
                  position: 'absolute', top: 1, right: 1, background: 'rgba(0,0,0,0.65)', border: 'none',
                  borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#fff', padding: 0,
                }}
              >
                <X size={9} />
              </button>
            </div>
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
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          placeholder="Ask anything… @selection @file @folder @terminal @problems @codebase @web @docs · paste/drop an image · Shift+Enter new line"
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
        {!isStreaming && (
          <button
            onClick={() => imageFileInputRef.current?.click()}
            title="Attach image"
            style={{
              background: 'none',
              border: 'none',
              borderRadius: 6,
              padding: '5px 8px',
              cursor: 'pointer',
              color: fg[3],
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ImageIcon size={13} />
          </button>
        )}
        <input
          ref={imageFileInputRef}
          type="file"
          accept="image/*"
          multiple
          aria-label="Attach image"
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = e.target.files
            if (files) for (const f of files) addImageFile(f)
            e.target.value = ''
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
            disabled={!text.trim() && pendingImages.length === 0}
            title="Send (Enter)"
            style={{
              background: (text.trim() || pendingImages.length > 0) ? accent.violet.fg : surface.raised,
              border: 'none',
              borderRadius: 6,
              padding: '5px 8px',
              cursor: (text.trim() || pendingImages.length > 0) ? 'pointer' : 'not-allowed',
              color: (text.trim() || pendingImages.length > 0) ? '#fff' : fg[3],
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
