import { useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { fg, surface, radius, easing } from './tokens'

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  children: ReactNode
  active?: boolean
  activeColor?: string
  size?: number
}

export function IconButton({ children, active, activeColor, size = 28, disabled, ...rest }: IconButtonProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: radius.md,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: active ? `${activeColor ?? fg[1]}22` : hovered ? surface.raised : 'transparent',
        color: active ? activeColor ?? fg[0] : hovered ? fg[1] : fg[3],
        transition: `background ${0.15}s ${easing}, color ${0.15}s ${easing}`,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
