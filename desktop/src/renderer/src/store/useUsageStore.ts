import { create } from 'zustand'
import { estimateCostUsd } from '../modelRates'

interface UsageState {
  sessionInputTokens: number
  sessionOutputTokens: number
  sessionCostUsd: number
  lastModel: string
  addUsage: (inputTokens: number, outputTokens: number, model: string) => void
  resetSession: () => void
}

export const useUsageStore = create<UsageState>()((set) => ({
  sessionInputTokens: 0,
  sessionOutputTokens: 0,
  sessionCostUsd: 0,
  lastModel: '',
  addUsage: (inputTokens, outputTokens, model) =>
    set((s) => ({
      sessionInputTokens: s.sessionInputTokens + inputTokens,
      sessionOutputTokens: s.sessionOutputTokens + outputTokens,
      sessionCostUsd: s.sessionCostUsd + estimateCostUsd(model, inputTokens, outputTokens),
      lastModel: model,
    })),
  resetSession: () => set({ sessionInputTokens: 0, sessionOutputTokens: 0, sessionCostUsd: 0, lastModel: '' }),
}))
