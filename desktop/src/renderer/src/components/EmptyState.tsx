import type { ReactNode } from 'react'
import { accent, border, fg, surface } from '../design'

interface Props {
  icon: ReactNode
  title: string
  description: string
  action?: { label: string; onClick: () => void }
  secondaryAction?: { label: string; onClick: () => void }
}

export function EmptyState({ icon, title, description, action, secondaryAction }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        textAlign: 'center',
        gap: 12,
        flex: 1,
        minHeight: 200,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: surface.overlay,
          border: `1px solid ${border[0]}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: fg[3],
          marginBottom: 4,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: fg[1] }}>{title}</div>
      <div style={{ fontSize: 11, color: fg[3], lineHeight: 1.6, maxWidth: 260 }}>{description}</div>
      {(action || secondaryAction) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              style={{
                padding: '6px 14px',
                background: accent.amber.fg,
                color: '#000',
                border: 'none',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              style={{
                padding: '6px 14px',
                background: surface.float,
                color: fg[1],
                border: `1px solid ${border[0]}`,
                borderRadius: 6,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
