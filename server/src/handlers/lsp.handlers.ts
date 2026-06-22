import { JsonRpcProcessClient } from '../lsp/jsonRpcClient.js'
import { LANGUAGE_SERVERS, type LangKey } from '../lsp/config.js'
import type { HandlerRegistry, HandlerContext } from '../router.js'
import type { SandboxAdapter } from '../sandbox/types.js'

const clientsBySession = new Map<string, Map<LangKey, JsonRpcProcessClient>>()

function getClient(lang: LangKey, adapter: SandboxAdapter, ctx: HandlerContext): JsonRpcProcessClient {
  let perLang = clientsBySession.get(ctx.sessionId)
  if (!perLang) {
    perLang = new Map()
    clientsBySession.set(ctx.sessionId, perLang)
  }
  let client = perLang.get(lang)
  if (!client) {
    const def = LANGUAGE_SERVERS[lang]
    client = new JsonRpcProcessClient(adapter, {
      command: def.command,
      args: def.args,
      languageId: def.languageId,
      rootUri: 'file:///',
    })
    client.on('diagnostics', (params: unknown) => {
      ctx.send(`lsp:${lang}:diagnostics`, params)
    })
    perLang.set(lang, client)
  }
  return client
}

function registerForLanguage(registry: HandlerRegistry, lang: LangKey): void {
  registry.register(`lsp:${lang}:didOpen`, async (adapter, payload, ctx) => {
    const { uri, text } = payload as { uri: string; text: string }
    await getClient(lang, adapter, ctx).didOpen(uri, text)
  })

  registry.register(`lsp:${lang}:didChange`, async (adapter, payload, ctx) => {
    const { uri, text } = payload as { uri: string; text: string }
    await getClient(lang, adapter, ctx).didChange(uri, text)
  })

  registry.register(`lsp:${lang}:hover`, async (adapter, payload, ctx) => {
    const { uri, line, character } = payload as { uri: string; line: number; character: number }
    return getClient(lang, adapter, ctx).hover(uri, line, character)
  })

  registry.register(`lsp:${lang}:definition`, async (adapter, payload, ctx) => {
    const { uri, line, character } = payload as { uri: string; line: number; character: number }
    return getClient(lang, adapter, ctx).definition(uri, line, character)
  })
}

// Mirrors desktop/src/main/ipc/lsp.handlers.ts's channel names exactly
// (lsp:python:* / lsp:ts:*) — one JsonRpcProcessClient per session per
// language, since each session's sandbox holds a different project.
export function registerLspHandlers(registry: HandlerRegistry): void {
  for (const lang of Object.keys(LANGUAGE_SERVERS) as LangKey[]) {
    registerForLanguage(registry, lang)
  }

  registry.registerCleanup((sessionId) => {
    const perLang = clientsBySession.get(sessionId)
    if (perLang) {
      for (const client of perLang.values()) client.stop()
    }
    clientsBySession.delete(sessionId)
  })
}
