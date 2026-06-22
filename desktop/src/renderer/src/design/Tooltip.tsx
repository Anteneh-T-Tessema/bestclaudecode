import { useState, type ReactNode } from 'react'
import { surface, shadow, fg } from './tokens'

interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'right' | 'bottom'
}

export function Tooltip({ label, children, side = 'right' }: TooltipProps) {
  const [hovered, setHovered] = useState(false)

  const positionStyle =
    side === 'right'
      ? { left: 'calc(100% + 10px)', top: '50%', transform: 'translateY(-50%)' }
      : { top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' }

  const arrowStyle =
    side === 'right'
      ? { left: -4, top: '50%', transform: 'translateY(-50%) rotate(45deg)', borderRight: 'none', borderTop: 'none' }
      : { top: -4, left: '50%', transform: 'translateX(-50%) rotate(45deg)', borderLeft: 'none', borderBottom: 'none' }

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            ...positionStyle,
            background: surface.overlay,
            border: '1px solid hsl(222 18% 16%)',
            borderRadius: 5,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 500,
            color: fg[0],
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 9999,
            boxShadow: shadow.lg,
            letterSpacing: '0.01em',
          }}
        >
          {label}
          <div
            style={
              {
                position: 'absolute',
                width: 6,
                height: 6,
                background: surface.overlay,
                border: '1px solid hsl(222 18% 16%)',
                ...arrowStyle,
              } as React.CSSProperties
            }
          />
        </div>
      )}
    </div>
  )
}
