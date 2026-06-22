export const surface = {
  void: 'hsl(222 25% 2.5%)',
  base: 'hsl(222 22% 4%)',
  surface: 'hsl(222 20% 6.5%)',
  raised: 'hsl(222 18% 9%)',
  overlay: 'hsl(222 16% 12%)',
  float: 'hsl(222 14% 15%)',
} as const

export const fg = {
  0: 'hsl(210 20% 96%)', // primary text
  1: 'hsl(220 10% 76%)', // secondary
  2: 'hsl(220 8% 54%)', // tertiary
  3: 'hsl(220 8% 36%)', // dimmed
  4: 'hsl(220 8% 22%)', // very dim
} as const

export const border = {
  0: 'hsl(222 18% 14%)',
  1: 'hsl(222 18% 10%)',
  2: 'hsl(222 18% 7%)',
} as const

export const shadow = {
  xs: '0 1px 2px rgba(0,0,0,0.4)',
  sm: '0 2px 6px rgba(0,0,0,0.5)',
  md: '0 4px 14px rgba(0,0,0,0.55)',
  lg: '0 8px 28px rgba(0,0,0,0.6)',
  xl: '0 16px 48px rgba(0,0,0,0.7)',
} as const

export type AccentName = 'amber' | 'cyan' | 'green' | 'red' | 'violet' | 'blue'

export const accent: Record<
  AccentName,
  { fg: string; bright: string; dim: string; subtle: string; border: string }
> = {
  amber: {
    fg: 'hsl(38 94% 54%)',
    bright: 'hsl(40 96% 64%)',
    dim: 'hsl(36 72% 38%)',
    subtle: 'hsl(36 65% 8%)',
    border: 'hsl(36 60% 18%)',
  },
  cyan: {
    fg: 'hsl(190 88% 46%)',
    bright: 'hsl(188 92% 58%)',
    dim: 'hsl(190 65% 30%)',
    subtle: 'hsl(190 65% 7%)',
    border: 'hsl(190 55% 15%)',
  },
  green: {
    fg: 'hsl(145 64% 44%)',
    bright: 'hsl(142 70% 54%)',
    dim: 'hsl(145 50% 28%)',
    subtle: 'hsl(145 52% 6.5%)',
    border: 'hsl(145 48% 13%)',
  },
  red: {
    fg: 'hsl(2 74% 52%)',
    bright: 'hsl(2 82% 64%)',
    dim: 'hsl(2 60% 32%)',
    subtle: 'hsl(2 62% 7.5%)',
    border: 'hsl(2 58% 16%)',
  },
  violet: {
    fg: 'hsl(258 68% 60%)',
    bright: 'hsl(256 74% 72%)',
    dim: 'hsl(258 50% 36%)',
    subtle: 'hsl(258 52% 8.5%)',
    border: 'hsl(258 48% 20%)',
  },
  blue: {
    fg: 'hsl(212 88% 58%)',
    bright: 'hsl(212 80% 68%)',
    dim: 'hsl(212 60% 36%)',
    subtle: 'hsl(212 65% 8%)',
    border: 'hsl(212 55% 16%)',
  },
}

export const radius = {
  sm: 3,
  md: 5,
  lg: 8,
  pill: 999,
} as const

export const space = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 12,
  6: 16,
  7: 24,
  8: 32,
} as const

export const font = {
  mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
  ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const

export const easing = 'cubic-bezier(0.4,0,0.2,1)'
