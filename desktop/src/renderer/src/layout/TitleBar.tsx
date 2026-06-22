import { accent, border, fg, surface } from '../design'

export function TitleBar() {
  return (
    <div
      className="drag-region"
      style={
        {
          height: 42,
          background: surface.void,
          borderBottom: `1px solid ${border[2]}`,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 12,
          WebkitAppRegion: 'drag',
          flexShrink: 0,
          userSelect: 'none',
        } as React.CSSProperties
      }
    >
      {/* macOS traffic-light spacer */}
      <div style={{ width: 78, flexShrink: 0, pointerEvents: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <path d="M8 0 L15 3 V8 C15 12 12 15 8 16 C4 15 1 12 1 8 V3 Z" fill={accent.green.fg} opacity="0.85" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: fg[0] }}>
          LAKOORA
        </span>
      </div>
    </div>
  )
}
