import { store } from './store'

type Tier = 'fast' | 'strong'

const MODEL_BY_PROVIDER_AND_TIER: Record<string, Record<Tier, string>> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', strong: 'claude-opus-4-8' },
  openai: { fast: 'gpt-4o-mini', strong: 'gpt-4o' },
  google: { fast: 'gemini-2.0-flash', strong: 'gemini-1.5-pro' },
}

const PROVIDER_PRIORITY = ['anthropic', 'openai', 'google']

const COMPLEX_KEYWORDS = /\b(refactor|rewrite|redesign|migrate|architecture|overhaul)\b/i
const COMPLEX_LENGTH_THRESHOLD = 800

// Strip the known auto-injected context-block tags (Gaps 29/34/35 — these
// wrap retrieved codebase/memory context around the user's actual message)
// before measuring length/keywords, so injected context doesn't skew the
// complexity signal toward "strong" just because retrieval found a lot.
function classifyComplexity(taskText: string): Tier {
  const stripped = taskText.replace(/<(auto_context|agent_memory|codebase_context)[^>]*>[\s\S]*?<\/\1>/g, '').trim()
  if (stripped.length > COMPLEX_LENGTH_THRESHOLD || COMPLEX_KEYWORDS.test(stripped)) return 'strong'
  return 'fast'
}

function hasApiKey(provider: string): boolean {
  const key = provider === 'anthropic' ? 'anthropicApiKey' : provider === 'openai' ? 'openaiApiKey' : 'googleApiKey'
  return !!(store.get(key) as string | undefined)
}

/** Resolves 'auto' to a concrete model id based on task complexity and which
 * API keys are configured. Any other model id passes through unchanged —
 * this never overrides an explicit user choice. */
export function resolveModel(model: string, taskText: string): string {
  if (model !== 'auto') return model
  const tier = classifyComplexity(taskText)
  for (const provider of PROVIDER_PRIORITY) {
    if (hasApiKey(provider)) return MODEL_BY_PROVIDER_AND_TIER[provider][tier]
  }
  return 'claude-sonnet-4-6'
}
