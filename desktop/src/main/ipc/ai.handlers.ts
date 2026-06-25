import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import { spawn } from 'child_process'
import { store, getSecret } from '../store'
import { resolveModel } from '../modelRouter'
import { queryAgentMemory } from '../agentMemory'

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

// Shared cap on tool-calling rounds across all providers that support it
// (Claude, GPT, Gemini): each round streams a response, then runs any
// requested tool calls and feeds results back for another round. Capped to
// avoid a runaway loop if a tool keeps getting re-invoked.
const MAX_TOOL_ROUNDS = 6

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
        const { messages, model, systemPrompt: rawSystemPrompt } = opts
        const resolvedModel = resolveModel(model, messages[messages.length - 1]?.content ?? '')

        // Gap 92 — surface cross-session memory relevant to the latest user
        // message, the same BM25 lookup the autonomous agent already runs
        // per-subtask, so regular chat benefits from accumulated learnings
        // without the user needing to type @memory explicitly.
        let systemPrompt = rawSystemPrompt
        const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
        if (lastUserMessage.trim()) {
          const memories = await queryAgentMemory(lastUserMessage)
          if (memories.length > 0) {
            const block = memories
              .map((m) => `**${m.key}**${m.tags.length ? ` [${m.tags.join(', ')}]` : ''}\n${m.content}`)
              .join('\n\n')
            systemPrompt = `${systemPrompt ?? ''}\n\n## Relevant past learnings\n\n${block}`.trim()
          }
        }

        let totalInputTokens = 0
        let totalOutputTokens = 0

        if (resolvedModel.startsWith('claude')) {
          const { default: Anthropic } = await import('@anthropic-ai/sdk')
          const apiKey = getSecret('anthropicApiKey')
          if (!apiKey) throw new Error('Anthropic API key not configured. Go to Settings to add it.')

          const client = new Anthropic({ apiKey })
          type AnthropicMessageParam = Parameters<typeof client.messages.stream>[0]['messages'][number]
          type AnthropicToolUnion = NonNullable<Parameters<typeof client.messages.stream>[0]['tools']>[number]
          type AnthropicTool = Extract<AnthropicToolUnion, { input_schema: unknown }>

          const apiMessages: AnthropicMessageParam[] = messages
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

          const { getAggregatedTools, callQualifiedTool } = await import('../mcp/mcpManager')
          const mcpTools = getAggregatedTools()
          const anthropicTools: AnthropicTool[] = mcpTools.map((t) => ({
            name: t.qualifiedName,
            description: t.description,
            input_schema: t.inputSchema as AnthropicTool['input_schema'],
          }))

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (controller.signal.aborted) break

            const stream = client.messages.stream({
              model: resolvedModel, max_tokens: 4096, system: systemPrompt, messages: apiMessages,
              ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
            })

            for await (const chunk of stream) {
              if (controller.signal.aborted) break
              if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                send('ai:chunk', { streamId, delta: chunk.delta.text })
              }
            }
            if (controller.signal.aborted) break

            const finalMsg = await stream.finalMessage()
            totalInputTokens += finalMsg.usage.input_tokens
            totalOutputTokens += finalMsg.usage.output_tokens
            if (finalMsg.stop_reason !== 'tool_use') break

            const toolResultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
            for (const block of finalMsg.content) {
              if (block.type !== 'tool_use') continue
              send('ai:chunk', { streamId, delta: `\n\n*🔧 Using tool \`${block.name}\`…*\n\n` })
              const result = await callQualifiedTool(block.name, (block.input as Record<string, unknown>) ?? {})
              toolResultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: result })
            }
            if (toolResultBlocks.length === 0) break

            apiMessages.push({ role: 'assistant', content: finalMsg.content as AnthropicMessageParam['content'] })
            apiMessages.push({ role: 'user', content: toolResultBlocks })
          }
        } else if (resolvedModel.startsWith('gpt') || resolvedModel.startsWith('o1') || resolvedModel.startsWith('o3')) {
          const { default: OpenAI } = await import('openai')
          const apiKey = getSecret('openaiApiKey')
          if (!apiKey) throw new Error('OpenAI API key not configured. Go to Settings to add it.')

          const client = new OpenAI({ apiKey })
          type OpenAIMessageParam = Parameters<typeof client.chat.completions.create>[0]['messages'][number]
          type OpenAITool = NonNullable<Parameters<typeof client.chat.completions.create>[0]['tools']>[number]

          const apiMessages: OpenAIMessageParam[] = messages.map((m) => {
            if (!m.images?.length) return { role: m.role, content: m.content } as OpenAIMessageParam
            const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
            if (m.content) parts.push({ type: 'text', text: m.content })
            for (const img of m.images) parts.push({ type: 'image_url', image_url: { url: img } })
            return { role: m.role, content: parts } as OpenAIMessageParam
          })
          if (systemPrompt) apiMessages.unshift({ role: 'system', content: systemPrompt })

          const { getAggregatedTools, callQualifiedTool } = await import('../mcp/mcpManager')
          const mcpTools = getAggregatedTools()
          const openaiTools: OpenAITool[] = mcpTools.map((t) => ({
            type: 'function',
            function: {
              name: t.qualifiedName,
              description: t.description,
              parameters: t.inputSchema,
            },
          }))

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (controller.signal.aborted) break

            const stream = await client.chat.completions.create({
              model: resolvedModel, messages: apiMessages, stream: true,
              stream_options: { include_usage: true },
              ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
            })

            const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>()
            for await (const chunk of stream) {
              if (controller.signal.aborted) break
              if (chunk.usage) {
                totalInputTokens += chunk.usage.prompt_tokens ?? 0
                totalOutputTokens += chunk.usage.completion_tokens ?? 0
              }
              const delta = chunk.choices[0]?.delta?.content ?? ''
              if (delta) send('ai:chunk', { streamId, delta })

              for (const tc of chunk.choices[0]?.delta?.tool_calls ?? []) {
                const existing = toolCallsByIndex.get(tc.index)
                if (existing) {
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments
                } else {
                  toolCallsByIndex.set(tc.index, {
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    arguments: tc.function?.arguments ?? '',
                  })
                }
              }
            }
            if (controller.signal.aborted) break

            const toolCalls = [...toolCallsByIndex.values()]
            if (toolCalls.length === 0) break

            const toolResultMessages: OpenAIMessageParam[] = []
            for (const tc of toolCalls) {
              send('ai:chunk', { streamId, delta: `\n\n*🔧 Using tool \`${tc.name}\`…*\n\n` })
              let result: string
              try {
                const args = tc.arguments ? JSON.parse(tc.arguments) as Record<string, unknown> : {}
                result = await callQualifiedTool(tc.name, args)
              } catch (err) {
                result = `Error: could not parse tool arguments for "${tc.name}": ${(err as Error).message}`
              }
              toolResultMessages.push({ role: 'tool', tool_call_id: tc.id, content: result })
            }

            apiMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments },
              })),
            } as OpenAIMessageParam)
            apiMessages.push(...toolResultMessages)
          }
        } else if (resolvedModel.startsWith('gemini')) {
          const { GoogleGenerativeAI, SchemaType } = await import('@google/generative-ai')
          const apiKey = getSecret('googleApiKey')
          if (!apiKey) throw new Error('Google API key not configured. Go to Settings to add it.')

          const client = new GoogleGenerativeAI(apiKey)

          // Minimal JSON-Schema -> Gemini Schema mapping: only `type` needs
          // converting (Gemini wants the SchemaType enum, not a bare string),
          // everything else (properties/items/required/description) already
          // lines up with what mcpManager.ts's tool schemas produce.
          const toGeminiSchemaType = (t: unknown): (typeof SchemaType)[keyof typeof SchemaType] => {
            switch (t) {
              case 'string': return SchemaType.STRING
              case 'number': return SchemaType.NUMBER
              case 'integer': return SchemaType.INTEGER
              case 'boolean': return SchemaType.BOOLEAN
              case 'array': return SchemaType.ARRAY
              default: return SchemaType.OBJECT
            }
          }
          const toGeminiSchema = (schema: Record<string, unknown>): Record<string, unknown> => {
            const out: Record<string, unknown> = { ...schema, type: toGeminiSchemaType(schema.type) }
            if (schema.properties && typeof schema.properties === 'object') {
              out.properties = Object.fromEntries(
                Object.entries(schema.properties as Record<string, unknown>).map(
                  ([k, v]) => [k, toGeminiSchema(v as Record<string, unknown>)],
                ),
              )
            }
            if (schema.items && typeof schema.items === 'object') {
              out.items = toGeminiSchema(schema.items as Record<string, unknown>)
            }
            return out
          }

          const { getAggregatedTools, callQualifiedTool } = await import('../mcp/mcpManager')
          const mcpTools = getAggregatedTools()
          type GenerativeModelParams = Parameters<typeof client.getGenerativeModel>[0]
          type GeminiTool = NonNullable<GenerativeModelParams['tools']>[number]
          // toGeminiSchema returns Record<string, unknown> by design (it's a
          // recursive structural transform), so TS can't statically prove it
          // matches the SDK's FunctionDeclarationSchema shape — the cast is
          // safe because toGeminiSchemaType always normalizes `type` to a
          // valid SchemaType enum value, satisfying that interface at runtime.
          const geminiTools: GeminiTool[] = mcpTools.length > 0
            ? [{
                functionDeclarations: mcpTools.map((t) => ({
                  name: t.qualifiedName,
                  description: t.description,
                  parameters: toGeminiSchema(t.inputSchema) as unknown as import('@google/generative-ai').FunctionDeclarationSchema,
                })),
              }]
            : []

          const gModel = client.getGenerativeModel({
            model: resolvedModel, systemInstruction: systemPrompt ?? undefined,
            ...(geminiTools.length > 0 ? { tools: geminiTools } : {}),
          })

          const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }))
          const lastMsg = messages[messages.length - 1]
          const chat = gModel.startChat({ history })

          type GeminiFunctionResponsePart = { functionResponse: { name: string; response: { content: string } } }
          let nextRequest: string | GeminiFunctionResponsePart[] = lastMsg?.content ?? ''
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (controller.signal.aborted) break

            const result = await chat.sendMessageStream(nextRequest)
            for await (const chunk of result.stream) {
              if (controller.signal.aborted) break
              const text = chunk.text()
              if (text) send('ai:chunk', { streamId, delta: text })
            }
            if (controller.signal.aborted) break

            const finalResponse = await result.response
            totalInputTokens += finalResponse.usageMetadata?.promptTokenCount ?? 0
            totalOutputTokens += finalResponse.usageMetadata?.candidatesTokenCount ?? 0
            const functionCalls = finalResponse.functionCalls() ?? []
            if (functionCalls.length === 0) break

            const responseParts: GeminiFunctionResponsePart[] = []
            for (const call of functionCalls) {
              send('ai:chunk', { streamId, delta: `\n\n*🔧 Using tool \`${call.name}\`…*\n\n` })
              const toolResult = await callQualifiedTool(call.name, (call.args as Record<string, unknown>) ?? {})
              responseParts.push({ functionResponse: { name: call.name, response: { content: toolResult } } })
            }
            nextRequest = responseParts
          }
        } else {
          const ollamaUrl = (store.get('ollamaUrl') as string) || 'http://localhost:11434'
          const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }))
          if (systemPrompt) apiMessages.unshift({ role: 'system', content: systemPrompt })

          const resp = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: resolvedModel, messages: apiMessages, stream: true }),
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
                  if (parsed.done && parsed.prompt_eval_count != null) {
                    totalInputTokens += parsed.prompt_eval_count as number
                    totalOutputTokens += (parsed.eval_count as number) ?? 0
                  }
                } catch { /* skip malformed lines */ }
              }
            }
          } finally {
            reader.cancel().catch(() => {})
          }
        }

        if (totalInputTokens > 0 || totalOutputTokens > 0) {
          send('ai:usage', { streamId, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: resolvedModel })
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
      const mistralKey = getSecret('mistralApiKey')
      if (mistralKey) {
        const result = await codestralFIM(prefix, suffix, snippets, mistralKey).catch(() => null)
        if (result !== null) return result
      }

      const fireworksKey = getSecret('fireworksApiKey')
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
        const apiKey = getSecret('anthropicApiKey')
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
        const apiKey = getSecret('openaiApiKey')
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

  ipcMain.handle('ai:predictNextEdit', async (_event, opts: {
    filePath: string; fullContent: string; cursorLine: number; cursorColumn: number; acceptedText: string; model: string
  }): Promise<{ line: number; column: number; insertText: string } | null> => {
    const { filePath, fullContent, cursorLine, cursorColumn, acceptedText, model } = opts
    const prompt = `The user just accepted the completion "${acceptedText}" at line ${cursorLine}, column ${cursorColumn} of ${filePath}.

Given the full file content below, predict the NEXT edit location and text (e.g. a matching closing tag, a paired variable, the next argument in a call).

Respond ONLY with valid JSON: {"line": <number>, "column": <number>, "insertText": "<text>"} or {} if no obvious next edit.

File content:
${fullContent.slice(0, 8000)}`

    try {
      if (model.startsWith('claude')) {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const apiKey = getSecret('anthropicApiKey')
        if (!apiKey) return null
        const client = new Anthropic({ apiKey })
        const msg = await client.messages.create({
          model, max_tokens: 80, temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        })
        const block = msg.content[0]
        if (block?.type !== 'text') return null
        const parsed = JSON.parse(block.text.trim()) as Record<string, unknown>
        if (typeof parsed.line !== 'number' || typeof parsed.column !== 'number' || typeof parsed.insertText !== 'string') return null
        return { line: parsed.line, column: parsed.column, insertText: parsed.insertText }
      }
    } catch { /* fall through */ }
    return null
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

  ipcMain.handle('ai:exportChat', async (_, opts: { markdown: string; defaultFilename: string }): Promise<string | null> => {
    const { dialog } = await import('electron')
    const fs = await import('fs')
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Chat',
      defaultPath: opts.defaultFilename,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (canceled || !filePath) return null
    fs.writeFileSync(filePath, opts.markdown, 'utf-8')
    return filePath
  })
}
