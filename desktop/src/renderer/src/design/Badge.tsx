import type { ReactNode } from 'react'
import { accent, border, fg, type AccentName } from './tokens'

interface BadgeProps {
  children: ReactNode
  accent?: AccentName
  icon?: ReactNode
}

export function Badge({ children, accent: accentName, icon }: BadgeProps) {
  const colors = accentName
    ? { bg: accent[accentName].subtle, border: accent[accentName].border, text: accent[accentName].fg }
    : { bg: 'transparent', border: border[0], text: fg[2] }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.text,
        lineHeight: '14px',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {children}
    </span>
  )
}
