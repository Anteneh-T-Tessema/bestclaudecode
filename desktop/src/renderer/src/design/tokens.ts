// All color tokens reference CSS custom properties so the entire UI re-themes
// by swapping variable values on <html>. See App.tsx for dark/light definitions.
export const surface = {
  void:    'var(--surface-void)',
  base:    'var(--surface-base)',
  surface: 'var(--surface-surface)',
  raised:  'var(--surface-raised)',
  overlay: 'var(--surface-overlay)',
  float:   'var(--surface-float)',
}

export const fg = {
  0: 'var(--fg-0)',
  1: 'var(--fg-1)',
  2: 'var(--fg-2)',
  3: 'var(--fg-3)',
  4: 'var(--fg-4)',
}

export const border = {
  0: 'var(--border-0)',
  1: 'var(--border-1)',
  2: 'var(--border-2)',
}

export const shadow = {
  xs: 'var(--shadow-xs)',
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  xl: 'var(--shadow-xl)',
}

// Static dark-theme values used by Monaco (which needs hex, not var()) and
// by the theme injector in App.tsx.
export const DARK_TOKENS = {
  '--surface-void':    'hsl(222 25% 2.5%)',
  '--surface-base':    'hsl(222 22% 4%)',
  '--surface-surface': 'hsl(222 20% 6.5%)',
  '--surface-raised':  'hsl(222 18% 9%)',
  '--surface-overlay': 'hsl(222 16% 12%)',
  '--surface-float':   'hsl(222 14% 15%)',
  '--fg-0': 'hsl(210 20% 96%)',
  '--fg-1': 'hsl(220 10% 76%)',
  '--fg-2': 'hsl(220 8% 54%)',
  '--fg-3': 'hsl(220 8% 36%)',
  '--fg-4': 'hsl(220 8% 22%)',
  '--border-0': 'hsl(222 18% 14%)',
  '--border-1': 'hsl(222 18% 10%)',
  '--border-2': 'hsl(222 18% 7%)',
  '--shadow-xs': '0 1px 2px rgba(0,0,0,0.4)',
  '--shadow-sm': '0 2px 6px rgba(0,0,0,0.5)',
  '--shadow-md': '0 4px 14px rgba(0,0,0,0.55)',
  '--shadow-lg': '0 8px 28px rgba(0,0,0,0.6)',
  '--shadow-xl': '0 16px 48px rgba(0,0,0,0.7)',
} as const

export const LIGHT_TOKENS = {
  '--surface-void':    'hsl(220 14% 80%)',
  '--surface-base':    'hsl(220 14% 88%)',
  '--surface-surface': 'hsl(220 12% 92%)',
  '--surface-raised':  'hsl(0 0% 98%)',
  '--surface-overlay': 'hsl(220 10% 93%)',
  '--surface-float':   'hsl(220 8% 90%)',
  '--fg-0': 'hsl(220 25% 10%)',
  '--fg-1': 'hsl(220 15% 28%)',
  '--fg-2': 'hsl(220 10% 46%)',
  '--fg-3': 'hsl(220 8% 60%)',
  '--fg-4': 'hsl(220 6% 74%)',
  '--border-0': 'hsl(220 14% 76%)',
  '--border-1': 'hsl(220 14% 82%)',
  '--border-2': 'hsl(220 14% 88%)',
  '--shadow-xs': '0 1px 2px rgba(0,0,0,0.08)',
  '--shadow-sm': '0 2px 6px rgba(0,0,0,0.1)',
  '--shadow-md': '0 4px 14px rgba(0,0,0,0.12)',
  '--shadow-lg': '0 8px 28px rgba(0,0,0,0.14)',
  '--shadow-xl': '0 16px 48px rgba(0,0,0,0.18)',
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
