import { randomUUID } from 'node:crypto'
import type { HandlerRegistry } from '../router.js'
import { getSetting } from '../settings/store.js'
import { REPO_ROOT, runPythonJson } from '../pythonBridge.js'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface StreamChatOpts {
  messages: ChatMessage[]
  model: string
  systemPrompt?: string
}

const activeStreams = new Map<string, AbortController>()

// ---------------------------------------------------------------------------
// Per-session retrieval context cache
// ---------------------------------------------------------------------------
// ai:buildContext runs a hybrid search against the repo and caches top-N
// snippets per session. ai:complete reads this cache (with a 30s TTL) to
// inject codebase context into FIM prompts — avoiding per-keystroke Python
// subprocess latency while still giving the model relevant code examples.

interface ContextCache {
  snippets: string[]
  cachedAt: number
}

const contextCacheBySession = new Map<string, ContextCache>()
const CONTEXT_CACHE_TTL_MS = 30_000

function getContextSnippets(sessionId: string): string[] {
  const cache = contextCacheBySession.get(sessionId)
  if (!cache || Date.now() - cache.cachedAt > CONTEXT_CACHE_TTL_MS) return []
  return cache.snippets
}

// ---------------------------------------------------------------------------
// FIM helpers — Tier 1: Codestral, Tier 2: Fireworks Qwen2.5-Coder
// ---------------------------------------------------------------------------

// Inject context as a comment block prepended to the FIM prompt.  This is
// the standard "repo-level FIM" technique used by Cursor and GitHub Copilot:
// the model sees related code as context, then fills in the cursor position.
function buildFimPrompt(prefix: string, snippets: string[]): string {
  if (snippets.length === 0) return prefix.slice(-2000)
  const block = snippets.map((s) => `// ${s}`).join('\n')
  return `// Related codebase context:\n${block}\n\n${prefix.slice(-2000)}`
}

// Codestral FIM endpoint — API spec verified from @mistralai/mistralai npm
// tarball (src/models/components/fimcompletionrequest.ts, fimcompletionresponse.ts).
// Wire format uses snake_case keys; response lives in choices[0].message.content.
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

// Fireworks AI completions endpoint — OpenAI-compatible legacy completions
// (prompt + suffix fields) for FIM. Response lives in choices[0].text.
// NOTE: endpoint and model ID reflect Fireworks' documented naming conventions
// and are not verified from a live account here — they are the correct form
// per Fireworks' publicly documented API and common community references.
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

// Faithful port of desktop/src/main/ipc/ai.handlers.ts. The only structural
// change: API keys come from the per-session settings store (settings.handlers.ts)
// instead of electron-store, and chunks go out via ctx.send instead of
// event.sender.send — everything else (provider branching, 90s timeout,
// abort handling) is unchanged.
export function registerAiHandlers(registry: HandlerRegistry): void {
  registry.register('ai:streamChat', async (_adapter, payload, ctx) => {
    const opts = payload as StreamChatOpts
    const streamId = randomUUID()
    const controller = new AbortController()
    activeStreams.set(streamId, controller)

    // Fire the async work without awaiting — return streamId synchronously so
    // a concurrent ai:abortStream call can never race ahead of registration.
    void (async () => {
      const timeoutHandle = setTimeout(() => controller.abort(), 90_000)
      try {
        const { messages, model, systemPrompt } = opts

        if (model.startsWith('claude')) {
          const { default: Anthropic } = await import('@anthropic-ai/sdk')
          const apiKey = getSetting(ctx.sessionId, 'anthropicApiKey') as string | undefined
          if (!apiKey) throw new Error('Anthropic API key not configured. Go to Settings to add it.')

          const client = new Anthropic({ apiKey })
          const apiMessages = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

          const stream = client.messages.stream({
            model, max_tokens: 4096, system: systemPrompt, messages: apiMessages,
          })

          for await (const chunk of stream) {
            if (controller.signal.aborted) break
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              ctx.send('ai:chunk', { streamId, delta: chunk.delta.text })
            }
          }
        } else if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
          const { default: OpenAI } = await import('openai')
          const apiKey = getSetting(ctx.sessionId, 'openaiApiKey') as string | undefined
          if (!apiKey) throw new Error('OpenAI API key not configured. Go to Settings to add it.')

          const client = new OpenAI({ apiKey })
          const apiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> =
            messages.map((m) => ({ role: m.role, content: m.content }))
          if (systemPrompt) apiMessages.unshift({ role: 'system', content: systemPrompt })

          const stream = await client.chat.completions.create({ model, messages: apiMessages, stream: true })
          for await (const chunk of stream) {
            if (controller.signal.aborted) break
            const delta = chunk.choices[0]?.delta?.content ?? ''
            if (delta) ctx.send('ai:chunk', { streamId, delta })
          }
        } else if (model.startsWith('gemini')) {
          const { GoogleGenerativeAI } = await import('@google/generative-ai')
          const apiKey = getSetting(ctx.sessionId, 'googleApiKey') as string | undefined
          if (!apiKey) throw new Error('Google API key not configured. Go to Settings to add it.')

          const client = new GoogleGenerativeAI(apiKey)
          const gModel = client.getGenerativeModel({ model, systemInstruction: systemPrompt ?? undefined })

          const history = messages.slice(0, -1).map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }))
          const lastMsg = messages[messages.length - 1]
          const chat = gModel.startChat({ history })
          const result = await chat.sendMessageStream(lastMsg?.content ?? '')

          for await (const chunk of result.stream) {
            if (controller.signal.aborted) break
            const text = chunk.text()
            if (text) ctx.send('ai:chunk', { streamId, delta: text })
          }
        } else {
          const ollamaUrl = (getSetting(ctx.sessionId, 'ollamaUrl') as string | undefined) ?? 'http://localhost:11434'
          const apiMessages: Array<{ role: string; content: string }> =
            messages.map((m) => ({ role: m.role, content: m.content }))
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
              const errJson = await resp.json() as { error?: string }
              if (errJson?.error) errorMsg = errJson.error
            } catch { /* use statusText */ }
            throw new Error(`Ollama error: ${errorMsg}`)
          }

          const reader = resp.body!.getReader()
          const decoder = new TextDecoder()
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done || controller.signal.aborted) break
              const text = decoder.decode(value)
              for (const line of text.split('\n').filter(Boolean)) {
                try {
                  const parsed = JSON.parse(line) as { message?: { content?: string } }
                  if (parsed.message?.content) ctx.send('ai:chunk', { streamId, delta: parsed.message.content })
                } catch { /* skip malformed lines */ }
              }
            }
          } finally {
            await reader.cancel().catch(() => { /* already closed */ })
          }
        }

        ctx.send('ai:done', { streamId })
      } catch (err) {
        if (!controller.signal.aborted) {
          ctx.send('ai:error', { streamId, error: err instanceof Error ? err.message : String(err) })
        }
      } finally {
        clearTimeout(timeoutHandle)
        activeStreams.delete(streamId)
      }
    })()

    return streamId
  })

  // ai:complete — three-tier completion cascade:
  //   Tier 1: Codestral FIM (mistralApiKey set) — purpose-built FIM, best quality
  //   Tier 2: Fireworks Qwen2.5-Coder (fireworksApiKey set) — cheaper FIM-native fallback
  //   Tier 3: existing chat-model path (Claude/GPT/Ollama prompt-based) — always available
  //
  // Context snippets (from the ai:buildContext cache) are injected into the
  // FIM prompt as a comment block, giving the model codebase awareness without
  // per-keystroke Python subprocess overhead.
  registry.register('ai:complete', async (_adapter, payload, ctx) => {
    const { prefix, suffix, language, model } = payload as {
      prefix: string; suffix: string; language: string; model: string
    }

    const snippets = getContextSnippets(ctx.sessionId)

    try {
      // Tier 1: Codestral
      const mistralKey = getSetting(ctx.sessionId, 'mistralApiKey') as string | undefined
      if (mistralKey) {
        const result = await codestralFIM(prefix, suffix, snippets, mistralKey).catch(() => null)
        if (result !== null) return result
      }

      // Tier 2: Fireworks Qwen2.5-Coder
      const fireworksKey = getSetting(ctx.sessionId, 'fireworksApiKey') as string | undefined
      if (fireworksKey) {
        const result = await fireworksFIM(prefix, suffix, snippets, fireworksKey).catch(() => null)
        if (result !== null) return result
      }

      // Tier 3: existing chat-model fallback
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
        const apiKey = getSetting(ctx.sessionId, 'anthropicApiKey') as string | undefined
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
        const apiKey = getSetting(ctx.sessionId, 'openaiApiKey') as string | undefined
        if (!apiKey) return null
        const client = new OpenAI({ apiKey })
        const resp = await client.chat.completions.create({
          model, max_tokens: 100, temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        })
        return resp.choices[0]?.message?.content?.trimStart() ?? null
      } else {
        const ollamaUrl = (getSetting(ctx.sessionId, 'ollamaUrl') as string | undefined) ?? 'http://localhost:11434'
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

  // ai:buildContext — runs a hybrid search and caches the top context snippets
  // for this session so ai:complete can inject them without spawning Python on
  // every keystroke. Frontend calls this when a file is opened or the active
  // symbol changes; 30s TTL means stale results are naturally evicted.
  registry.register('ai:buildContext', async (_adapter, payload, ctx) => {
    const { query } = payload as { query: string }
    if (!query.trim()) return { cached: false, count: 0 }
    try {
      const result = await runPythonJson(['-m', 'src.vector_index', query, REPO_ROOT, '--json', '--hybrid'])
      const snippets = result.results.slice(0, 5).map((r) => {
        const filename = r.file.split('/').pop() ?? r.file
        const symbol = r.line.replace(/^\s+/, '').replace(/ -- line \d+$/, '')
        return `${symbol} [${filename}]`
      })
      contextCacheBySession.set(ctx.sessionId, { snippets, cachedAt: Date.now() })
      return { cached: true, count: snippets.length }
    } catch {
      return { cached: false, count: 0 }
    }
  })

  registry.register('ai:abortStream', async (_adapter, payload) => {
    const streamId = payload as string
    activeStreams.get(streamId)?.abort()
    activeStreams.delete(streamId)
  })

  registry.register('ai:listOllamaModels', async (_adapter, _payload, ctx) => {
    try {
      const ollamaUrl = (getSetting(ctx.sessionId, 'ollamaUrl') as string | undefined) ?? 'http://localhost:11434'
      const resp = await fetch(`${ollamaUrl}/api/tags`)
      if (!resp.ok) return []
      const data = await resp.json() as { models: Array<{ name: string }> }
      return data.models?.map((m) => m.name) ?? []
    } catch {
      return []
    }
  })

  registry.registerCleanup((sessionId) => {
    contextCacheBySession.delete(sessionId)
  })
}
