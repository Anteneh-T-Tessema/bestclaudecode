import type { ReactNode } from 'react'
import { border, fg, surface } from './tokens'

interface PanelHeaderProps {
  icon?: ReactNode
  label: string
  actions?: ReactNode
}

export function PanelHeader({ icon, label, actions }: PanelHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: `1px solid ${border[1]}`,
        flexShrink: 0,
      }}
    >
      {icon}
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: fg[0], flex: 1 }}>
        {label}
      </span>
      {actions}
    </div>
  )
}

interface PanelProps extends PanelHeaderProps {
  children?: ReactNode
}

export function Panel({ icon, label, actions, children }: PanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: surface.surface }}>
      <PanelHeader icon={icon} label={label} actions={actions} />
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
    </div>
  )
}
