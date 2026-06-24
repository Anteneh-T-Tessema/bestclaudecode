import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import { spawn } from 'child_process'
import { store } from '../store'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[]
}

// Splits a "data:image/png;base64,AAAA..." URL into { mediaType, data }.
function splitDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  return m ? { mediaType: m[1], data: m[2] } : null
}

interface StreamChatOpts {
  messages: ChatMessage[]
  model: string
  systemPrompt?: string
}

const activeStreams = new Map<string, AbortController>()

// ---------------------------------------------------------------------------
// Per-window retrieval context cache (keyed by BrowserWindow webContents id)
// ---------------------------------------------------------------------------
interface ContextCache {
  snippets: string[]
  cachedAt: number
}

const contextCacheByWindow = new Map<number, ContextCache>()
const CONTEXT_CACHE_TTL_MS = 30_000

function getContextSnippets(windowId: number): string[] {
  const cache = contextCacheByWindow.get(windowId)
  if (!cache || Date.now() - cache.cachedAt > CONTEXT_CACHE_TTL_MS) return []
  return cache.snippets
}

// ---------------------------------------------------------------------------
// Shared Python subprocess helper (Electron main doesn't use pythonBridge.ts)
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
const VENV_PYTHON = path.join(REPO_ROOT, '.venv', 'bin', 'python')

interface PythonJsonResult {
  docCount: number
  avgDl: number
  results: Array<{ score: number; file: string; line: string }>
  backend?: string
}

function runPythonJson(args: string[]): Promise<PythonJsonResult> {
  return new Promise((resolve) => {
    const proc = spawn(VENV_PYTHON, args, { cwd: REPO_ROOT })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', () => {
      try {
        resolve(JSON.parse(stdout) as PythonJsonResult)
      } catch {
        resolve({ docCount: 0, avgDl: 0, results: [] })
      }
    })
    proc.on('error', () => resolve({ docCount: 0, avgDl: 0, results: [] }))
  })
}

// ---------------------------------------------------------------------------
// FIM helpers — Tier 1: Codestral, Tier 2: Fireworks Qwen2.5-Coder
// ---------------------------------------------------------------------------

function buildFimPrompt(prefix: string, snippets: string[]): string {
  if (snippets.length === 0) return prefix.slice(-2000)
  const block = snippets.map((s) => `// ${s}`).join('\n')
  return `// Related codebase context:\n${block}\n\n${prefix.slice(-2000)}`
}

async function codestralFIM(
  prefix: string,
  suffix: string,
  snippets: string[],
  apiKey: string,
): Promise<string | null> {
  const res = await fetch('https://api.mistral.ai/v1/fim/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'codestral-latest',
      prompt: buildFimPrompt(prefix, snippets),
      suffix: suffix.slice(0, 500),
      max_tokens: 150,
      temperature: 0,
      stop: ['\n\n', '```'],
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content?.trimStart() ?? null
}

async function fireworksFIM(
  prefix: string,
  suffix: string,
  snippets: string[],
  apiKey: string,
): Promise<string | null> {
  const res = await fetch('https://api.fireworks.ai/inference/v1/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'accounts/fireworks/models/qwen2p5-coder-32b-instruct',
      prompt: buildFimPrompt(prefix, snippets),
      suffix: suffix.slice(0, 500),
      max_tokens: 150,
      temperature: 0,
      stop: ['\n\n', '```'],
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const data = await res.json() as { choices?: Array<{ text?: string }> }
  return data.choices?.[0]?.text?.trimStart() ?? null
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerAiHandlers(): void {
  ipcMain.handle('ai:streamChat', (event, opts: StreamChatOpts) => {
    const streamId = randomUUID()
    const controller = new AbortController()
    activeStreams.set(streamId, controller)

    const send = (channel: string, data: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        event.sender.send(channel, data)
      }
    }

    void (async () => {
      const timeoutHandle = setTimeout(() => controller.abort(), 90_000)
      try {
        const { messages, model, systemPrompt } = opts

        if (model.startsWith('claude')) {
          const { default: Anthropic } = await import('@anthropic-ai/sdk')
          const apiKey = store.get('anthropicApiKey') as string | undefined
          if (!apiKey) throw new Error('Anthropic API key not configured. Go to Settings to add it.')

          const client = new Anthropic({ apiKey })
          const apiMessages = messages
            .filter(m => m.role !== 'system')
            .map((m) => {
              const role = m.role as 'user' | 'assistant'
              if (!m.images?.length) return { role, content: m.content }
              const blocks: Array<
                | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } }
                | { type: 'text'; text: string }
              > = []
              for (const img of m.images) {
                const split = splitDataUrl(img)
                if (!split) continue
                blocks.push({
                  type: 'image',
                  source: { type: 'base64', media_type: split.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: split.data },
                })
              }
              if (m.content) blocks.push({ type: 'text', text: m.content })
              return { role, content: blocks }
            })

          const stream = client.messages.stream({
            model, max_tokens: 4096, system: systemPrompt, messages: apiMessages,
          })

          for await (const chunk of stream) {
            if (controller.signal.aborted) break
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              send('ai:chunk', { streamId, delta: chunk.delta.text })
            }
          }
        } else if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
          const { default: OpenAI } = await import('openai')
          const apiKey = store.get('openaiApiKey') as string | undefined
          if (!apiKey) throw new Error('OpenAI API key not configured. Go to Settings to add it.')

          const client = new OpenAI({ apiKey })
          const apiMessages = messages.map((m) => {
            if (!m.images?.length) return { role: m.role, content: m.content }
            const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
            if (m.content) parts.push({ type: 'text', text: m.content })
            for (const img of m.images) parts.push({ type: 'image_url', image_url: { url: img } })
            return { role: m.role, content: parts }
          })
          if (systemPrompt) apiMessages.unshift({ role: 'system', content: systemPrompt })

          const stream = await client.chat.completions.create({
            model, messages: apiMessages as Parameters<typeof client.chat.completions.create>[0]['messages'], stream: true,
          })
          for await (const chunk of stream) {
            if (controller.signal.aborted) break
            const delta = chunk.choices[0]?.delta?.content ?? ''
            if (delta) send('ai:chunk', { streamId, delta })
          }
        } else if (model.startsWith('gemini')) {
          const { GoogleGenerativeAI } = await import('@google/generative-ai')
          const apiKey = store.get('googleApiKey') as string | undefined
          if (!apiKey) throw new Error('Google API key not configured. Go to Settings to add it.')

          const client = new GoogleGenerativeAI(apiKey)
          const gModel = client.getGenerativeModel({ model, systemInstruction: systemPrompt ?? undefined })

          const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }))
          const lastMsg = messages[messages.length - 1]
          const chat = gModel.startChat({ history })
          const result = await chat.sendMessageStream(lastMsg?.content ?? '')

          for await (const chunk of result.stream) {
            if (controller.signal.aborted) break
            const text = chunk.text()
            if (text) send('ai:chunk', { streamId, delta: text })
          }
        } else {
          const ollamaUrl = (store.get('ollamaUrl') as string) || 'http://localhost:11434'
          const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }))
          if (systemPrompt) apiMessages.unshift({ role: 'system', content: systemPrompt })

          const resp = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: apiMessages, stream: true }),
            signal: controller.signal,
          })

          if (!resp.ok) {
            let errorMsg = resp.statusText
            try {
              const errJson = await resp.json()
              if (errJson && typeof errJson === 'object' && 'error' in errJson) errorMsg = String(errJson.error)
            } catch { /* use statusText */ }
            throw new Error(`Ollama error: ${errorMsg}`)
          }

          const reader = resp.body!.getReader()
          const decoder = new TextDecoder()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done || controller.signal.aborted) break
              const text = decoder.decode(value)
              for (const line of text.split('\n').filter(Boolean)) {
                try {
                  const parsed = JSON.parse(line)
                  if (parsed.message?.content) send('ai:chunk', { streamId, delta: parsed.message.content })
                } catch { /* skip malformed lines */ }
              }
            }
          } finally {
            reader.cancel().catch(() => {})
          }
        }

        send('ai:done', { streamId })
      } catch (err) {
        if (!controller.signal.aborted) {
          send('ai:error', { streamId, error: (err as Error).message })
        }
      } finally {
        clearTimeout(timeoutHandle)
        activeStreams.delete(streamId)
      }
    })()

    return streamId
  })

  // Three-tier completion cascade:
  //   Tier 1: Codestral FIM (mistralApiKey set) — purpose-built FIM
  //   Tier 2: Fireworks Qwen2.5-Coder (fireworksApiKey set) — cheaper FIM fallback
  //   Tier 3: existing chat-model path — always available
  ipcMain.handle('ai:complete', async (event, opts: { prefix: string; suffix: string; language: string; model: string }) => {
    const { prefix, suffix, language, model } = opts
    const windowId = event.sender.id
    const snippets = getContextSnippets(windowId)

    try {
      const mistralKey = store.get('mistralApiKey') as string | undefined
      if (mistralKey) {
        const result = await codestralFIM(prefix, suffix, snippets, mistralKey).catch(() => null)
        if (result !== null) return result
      }

      const fireworksKey = store.get('fireworksApiKey') as string | undefined
      if (fireworksKey) {
        const result = await fireworksFIM(prefix, suffix, snippets, fireworksKey).catch(() => null)
        if (result !== null) return result
      }

      const prompt = `Complete the following ${language} code. Return ONLY the completion text (what comes right after the cursor), no explanation, no markdown fences, no preamble. Complete no more than one expression or statement. If nothing useful to add, return empty string.

<prefix>
${prefix.slice(-1500)}
</prefix>
<suffix>
${suffix.slice(0, 300)}
</suffix>

Completion (text only, no preamble):`

      if (model.startsWith('claude')) {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const apiKey = store.get('anthropicApiKey') as string | undefined
        if (!apiKey) return null
        const client = new Anthropic({ apiKey })
        const msg = await client.messages.create({
          model, max_tokens: 100, temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        })
        const block = msg.content[0]
        return block?.type === 'text' ? block.text.trimStart() : null
      } else if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
        const { default: OpenAI } = await import('openai')
        const apiKey = store.get('openaiApiKey') as string | undefined
        if (!apiKey) return null
        const client = new OpenAI({ apiKey })
        const resp = await client.chat.completions.create({
          model, max_tokens: 100, temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        })
        return resp.choices[0]?.message?.content?.trimStart() ?? null
      } else {
        const ollamaUrl = (store.get('ollamaUrl') as string | undefined) ?? 'http://localhost:11434'
        const resp = await fetch(`${ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, stream: false, options: { num_predict: 80, temperature: 0 },
            messages: [{ role: 'user', content: prompt }],
          }),
        })
        if (!resp.ok) return null
        const data = await resp.json() as { message?: { content?: string } }
        return data.message?.content?.trimStart() ?? null
      }
    } catch {
      return null
    }
  })

  // Runs hybrid search and caches snippets per-window for the 30s TTL.
  // Called when a file opens; completion reads from cache without subprocess overhead.
  ipcMain.handle('ai:buildContext', async (event, opts: { query: string }) => {
    const { query } = opts
    if (!query.trim()) return { cached: false, count: 0 }
    try {
      const result = await runPythonJson(['-m', 'src.vector_index', query, REPO_ROOT, '--json', '--hybrid'])
      const snippets = result.results.slice(0, 5).map((r) => {
        const filename = r.file.split('/').pop() ?? r.file
        const symbol = r.line.replace(/^\s+/, '').replace(/ -- line \d+$/, '')
        return `${symbol} [${filename}]`
      })
      contextCacheByWindow.set(event.sender.id, { snippets, cachedAt: Date.now() })
      return { cached: true, count: snippets.length }
    } catch {
      return { cached: false, count: 0 }
    }
  })

  ipcMain.handle('ai:abortStream', (_, streamId: string) => {
    activeStreams.get(streamId)?.abort()
    activeStreams.delete(streamId)
  })

  ipcMain.handle('ai:listOllamaModels', async () => {
    try {
      const ollamaUrl = (store.get('ollamaUrl') as string) || 'http://localhost:11434'
      const resp = await fetch(`${ollamaUrl}/api/tags`)
      if (!resp.ok) return []
      const data = await resp.json() as { models: Array<{ name: string }> }
      return data.models?.map((m) => m.name) ?? []
    } catch {
      return []
    }
  })
}
