import { useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { fg, surface, border, accent, radius, easing } from './tokens'

type Variant = 'primary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  children?: ReactNode
}

const SIZE_PADDING: Record<Size, string> = {
  sm: '4px 10px',
  md: '7px 16px',
}

const SIZE_FONT: Record<Size, number> = { sm: 10, md: 12 }

export function Button({ variant = 'ghost', size = 'md', icon, children, disabled, ...rest }: ButtonProps) {
  const [hovered, setHovered] = useState(false)

  const palette = {
    primary: {
      bg: hovered ? accent.amber.bright : accent.amber.fg,
      color: surface.void,
      border: 'none',
    },
    ghost: {
      bg: hovered ? surface.raised : 'transparent',
      color: fg[1],
      border: `1px solid ${border[0]}`,
    },
    danger: {
      bg: hovered ? accent.red.dim : accent.red.subtle,
      color: accent.red.bright,
      border: `1px solid ${accent.red.border}`,
    },
  }[variant]

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: SIZE_PADDING[size],
        fontSize: SIZE_FONT[size],
        fontWeight: 600,
        letterSpacing: '0.02em',
        borderRadius: radius.md,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: `background ${0.15}s ${easing}, border-color ${0.15}s ${easing}`,
        background: palette.bg,
        color: palette.color,
        border: palette.border,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
