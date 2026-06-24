/**
 * Approximate provider list pricing ($ per 1M tokens) — for the in-app cost
 * estimate badge only, not for billing. Unknown model ids (e.g. local Ollama
 * models) return a cost of 0 rather than guessing.
 */
interface ModelRate {
  input: number
  output: number
}

const MODEL_RATES: Record<string, ModelRate> = {
  'claude-opus-4-8': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = MODEL_RATES[model]
  if (!rate) return 0
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
}
