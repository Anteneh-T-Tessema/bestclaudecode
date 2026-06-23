import { useState, useRef, useCallback, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { useChatStore } from '../../store/useChatStore'
import { useEditorStore } from '../../store/useEditorStore'
import { useSettingsStore } from '../../store/useSettingsStore'
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

export function ChatInput() {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

    // @file — attach current editor content
    let finalContent = content
    const activeTab = getActiveTab()
    if (content.includes('@file') && activeTab) {
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

    const messages = useChatStore
      .getState()
      .messages.map((m) => ({ role: m.role, content: m.content }))

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

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      }}
    >
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything… @file @codebase @web @docs @issue @pr · Shift+Enter new line"
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
          Enter · @file @codebase @web @docs @issue @pr
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
